import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces, hostname } from "node:os";
import path from "node:path";

const certDir = path.join(process.cwd(), ".certs");

/** LAN addresses a phone can use to reach this computer. */
export function localIpv4(): string[] {
  const ips = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) ips.add(entry.address);
    }
  }
  return [...ips];
}

/** Local domain names that iPhones on the same Wi-Fi can resolve via Bonjour/mDNS. */
export function localDomains(): string[] {
  const dns = new Set<string>(["localhost"]);
  const host = hostname();
  if (host) {
    dns.add(host);
    if (!host.endsWith(".local")) dns.add(`${host}.local`);
  }
  try {
    const localHostName = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
    if (localHostName) {
      dns.add(localHostName);
      dns.add(`${localHostName}.local`);
      dns.add(`${localHostName.toLowerCase()}.local`);
    }
  } catch {
    /* fallback to hostname */
  }
  return [...dns];
}

/**
 * A certificate that names localhost, this computer's Bonjour .local names and LAN addresses.
 * iPhone Safari only allows the camera on HTTPS, and provides the "visit this website" bypass
 * when accessed through a domain name like https://macbook-pro.local:3000.
 */
export function ensureLocalCertificate(): { key: Buffer; cert: Buffer } {
  mkdirSync(certDir, { recursive: true });
  const domains = localDomains();
  const ips = ["127.0.0.1", ...localIpv4()];
  const stamp = [...domains, ...ips].join(",");
  const stampPath = path.join(certDir, "stamp");
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  const current = existsSync(stampPath) ? readFileSync(stampPath, "utf8") : "";
  if (current !== stamp || !existsSync(keyPath) || !existsSync(certPath)) {
    const configPath = path.join(certDir, "openssl.cnf");
    const dnsLines = domains.map((d, index) => `DNS.${index + 1} = ${d}`);
    const ipLines = ips.map((ip, index) => `IP.${index + 1} = ${ip}`);
    const alt = [...dnsLines, ...ipLines].join("\n");
    writeFileSync(configPath, `[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = Saviny
[v3]
subjectAltName = @alt
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[alt]
${alt}
`);
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048",
        "-sha256",
        "-keyout", keyPath,
        "-out", certPath,
        "-days", "365",
        "-nodes",
        "-config", configPath,
      ], { stdio: "pipe" });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "openssl failed";
      throw new Error(`Could not create the local HTTPS certificate. ${detail}`);
    }
    writeFileSync(stampPath, stamp);

    // Automatically trust in macOS user keychain so Safari on Mac accepts it seamlessly
    try {
      execFileSync("security", [
        "add-trusted-cert",
        "-d",
        "-r", "trustRoot",
        "-k", `${process.env.HOME}/Library/Keychains/login.keychain-db`,
        certPath,
      ], { stdio: "pipe" });
    } catch {
      /* ignore if keychain prompt is declined or already present */
    }
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}
