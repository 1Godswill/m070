package com.sssacad.app;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Peer-to-peer LAN sync transport (no Android classes, so it can be unit-tested on a PC).
 * Every device runs a small TCP server on PORT and also scans its own /24 subnet(s) for other
 * SSSACAD devices, so any number of phones/tablets on the same hotspot or Wi-Fi find each other
 * with no pairing step. A device is only accepted if it proves it knows the shared PIN
 * (HMAC challenge-response; the PIN itself is never sent).
 */
public class LanSync {
    public interface Listener {
        void onUp(String id, String name);
        void onDown(String id);
        void onMessage(String id, String msg);
    }

    public static final int PORT = 47831;
    private static final int MAX_FRAME = 64 * 1024 * 1024;

    private final String myId, myName, pin;
    private final int port;
    private final Listener listener;
    private final SecureRandom rnd = new SecureRandom();
    private final Map<String, Peer> peers = new ConcurrentHashMap<>();
    private final Set<String> dialing = ConcurrentHashMap.newKeySet();
    private final Map<String, long[]> failures = new ConcurrentHashMap<>(); // ip -> {count, blockedUntil}
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "lansync"); t.setDaemon(true); return t; });
    private volatile boolean running;
    private ServerSocket server;
    private boolean scanning;

    private static class Peer {
        String id, name, ip; Socket sock; DataOutputStream out; volatile boolean replaced;
        synchronized boolean write(char type, String payload) {
            try {
                byte[] b = (type + payload).getBytes(StandardCharsets.UTF_8);
                out.writeInt(b.length); out.write(b); out.flush(); return true;
            } catch (IOException e) { close(); return false; }
        }
        void close() { try { sock.close(); } catch (IOException ignored) {} }
    }

    public LanSync(String id, String name, String pin, int port, boolean autoScan, Listener l) {
        this.myId = id; this.myName = name; this.pin = pin; this.port = port; this.listener = l; this.scanning = autoScan;
    }

    public synchronized void start() throws IOException {
        if (running) return;
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(port));
        running = true;
        pool.execute(this::acceptLoop);
        pool.execute(() -> { try { Thread.sleep(300); } catch (InterruptedException ignored) {} pingLoop(); });
        if (scanning) pool.execute(this::scanLoop);
    }

    public synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) {}
        for (Peer p : peers.values()) { p.replaced = true; p.close(); }
        peers.clear();
        pool.shutdownNow();
    }

    public boolean isRunning() { return running; }
    public int peerCount() { return peers.size(); }

    public boolean send(String peerId, String msg) {
        Peer p = peers.get(peerId);
        return p != null && p.write('M', msg);
    }

    /** Dial a specific host (used by the subnet scan and by tests). */
    public void connectTo(String host, int p) {
        String key = host + ":" + p;
        if (!running || !dialing.add(key)) return;
        pool.execute(() -> {
            try {
                Socket s = new Socket();
                s.connect(new InetSocketAddress(host, p), 600);
                session(s, true);
            } catch (Exception ignored) {
            } finally { dialing.remove(key); }
        });
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = server.accept();
                String ip = s.getInetAddress().getHostAddress();
                long[] f = failures.get(ip);
                if (f != null && f[0] >= 5 && System.currentTimeMillis() < f[1]) { s.close(); continue; }
                pool.execute(() -> session(s, false));
            } catch (IOException e) { if (!running) return; }
        }
    }

    private void scanLoop() {
        while (running) {
            try {
                Set<String> mine = new HashSet<>(); List<String> bases = new ArrayList<>();
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                    for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                        InetAddress a = ia.getAddress();
                        if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                            mine.add(a.getHostAddress());
                            String h = a.getHostAddress(); bases.add(h.substring(0, h.lastIndexOf('.') + 1));
                        }
                    }
                }
                Set<String> connected = new HashSet<>(); for (Peer p : peers.values()) connected.add(p.ip);
                Semaphore gate = new Semaphore(48);
                for (String base : new LinkedHashSet<>(bases)) for (int i = 1; i < 255; i++) {
                    String host = base + i;
                    if (mine.contains(host) || connected.contains(host)) continue;
                    gate.acquireUninterruptibly();
                    String key = host + ":" + PORT;
                    if (!dialing.add(key)) { gate.release(); continue; }
                    pool.execute(() -> {
                        try { Socket s = new Socket(); s.connect(new InetSocketAddress(host, PORT), 350); session(s, true); }
                        catch (Exception ignored) {} finally { dialing.remove(key); gate.release(); }
                    });
                }
            } catch (Exception ignored) {}
            try { Thread.sleep(peers.isEmpty() ? 5000 : 20000); } catch (InterruptedException e) { return; }
        }
    }

    private void pingLoop() {
        while (running) {
            try { Thread.sleep(15000); } catch (InterruptedException e) { return; }
            for (Peer p : peers.values()) p.write('P', "");
        }
    }

    private String hmac(String data) throws Exception {
        Mac m = Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(pin.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        StringBuilder sb = new StringBuilder();
        for (byte b : m.doFinal(data.getBytes(StandardCharsets.UTF_8))) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String readFrame(DataInputStream in) throws IOException {
        int n = in.readInt();
        if (n < 1 || n > MAX_FRAME) throw new IOException("bad frame");
        byte[] b = new byte[n]; in.readFully(b);
        return new String(b, StandardCharsets.UTF_8);
    }

    private void session(Socket s, boolean outgoing) {
        String ip = s.getInetAddress().getHostAddress();
        Peer peer = null;
        try {
            s.setTcpNoDelay(true); s.setKeepAlive(true); s.setSoTimeout(6000);
            DataInputStream in = new DataInputStream(new BufferedInputStream(s.getInputStream()));
            DataOutputStream out = new DataOutputStream(new BufferedOutputStream(s.getOutputStream()));
            Peer me = new Peer(); me.sock = s; me.out = out; me.ip = ip;
            byte[] nb = new byte[16]; rnd.nextBytes(nb); StringBuilder ns = new StringBuilder();
            for (byte b : nb) ns.append(String.format("%02x", b));
            String myNonce = ns.toString();
            me.write('H', myId + "\n" + myName.replace('\n', ' ') + "\n" + myNonce);
            String h = readFrame(in);
            String[] hp = h.substring(1).split("\n", 3);
            if (h.charAt(0) != 'H' || hp.length != 3 || hp[0].isEmpty() || hp[0].length() > 64 || hp[0].equals(myId)) { s.close(); return; }
            String theirId = hp[0], theirName = hp[1].length() > 40 ? hp[1].substring(0, 40) : hp[1], theirNonce = hp[2];
            if (theirNonce.length() != 32) { s.close(); return; }
            me.write('A', hmac(myNonce + "|" + theirNonce + "|" + myId));
            String a = readFrame(in);
            String want = hmac(theirNonce + "|" + myNonce + "|" + theirId);
            if (a.charAt(0) != 'A' || !MessageDigest.isEqual(a.substring(1).getBytes(StandardCharsets.UTF_8), want.getBytes(StandardCharsets.UTF_8))) {
                long[] f = failures.computeIfAbsent(ip, k -> new long[2]); f[0]++; f[1] = System.currentTimeMillis() + 60000;
                s.close(); return;
            }
            failures.remove(ip);
            me.id = theirId; me.name = theirName; peer = me;
            // one connection per pair: keep the one dialled by the device with the lower id
            boolean preferred = outgoing ? myId.compareTo(theirId) < 0 : theirId.compareTo(myId) < 0;
            synchronized (peers) {
                Peer old = peers.get(theirId);
                if (old != null) {
                    if (!preferred) { s.close(); return; }
                    old.replaced = true; old.close();
                }
                peers.put(theirId, me);
            }
            s.setSoTimeout(45000);
            if (peers.get(theirId) == me) listener.onUp(theirId, theirName);
            while (running) {
                String f = readFrame(in);
                if (f.charAt(0) == 'M') listener.onMessage(theirId, f.substring(1));
            }
        } catch (Exception ignored) {
        } finally {
            try { s.close(); } catch (IOException ignored) {}
            if (peer != null && peer.id != null) {
                boolean removed;
                synchronized (peers) { removed = peers.remove(peer.id, peer); }
                if (removed && !peer.replaced && running) listener.onDown(peer.id);
            }
        }
    }
}
