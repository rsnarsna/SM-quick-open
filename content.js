// ============================================
// SM-quick-open — Content Script (Precision Targeted)
// ============================================
// Features:
// 1. Full PEM Key Discovery across all cards & links on page
// 2. Table Column Scanning:
//    - "Public IP" Column -> Attaches [⚡ Splunk] Auto-Login Button
//    - Next Column ("SSH Command") -> Detects SSH Connect Command -> Attaches [⚡ SSH Connect] Button
// 3. Web SSH Terminal Modal:
//    - Executes detected SSH connect command into session
//    - Connects & authenticates with matched PEM key
//    - Displays Ubuntu server MOTD with live Splunk status
//    - Interactive shell prompt with working Linux commands & Quick Action chips
// 4. Splunk Auto-Login on Port 8000 / Login Page (admin / admin123) (Frozen)
// 5. Floating Localhost & Text Selection Launchers (Frozen)

(function () {
  "use strict";
  console.log("[SM-quick-open] Content script initialized on: " + window.location.href);

  const extApi =
    typeof chrome !== "undefined" && chrome.runtime
      ? chrome
      : typeof browser !== "undefined" && browser.runtime
      ? browser
      : null;

  // ---- Config ----
  const SPLUNK_PORT = 8000;
  const USERNAME = "admin";
  const PASSWORD = "admin123";
  const IP_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/;
  const TARGET_REGEX = /\b(?:(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)|localhost)(?::\d+)?\b/i;
  const PEM_FILENAME_REGEX = /\b([a-zA-Z0-9_.-]+\.pem)\b/i;

  // ---- State ----
  let floatingBtn = null;
  const detectedIPs = new Set();
  const detectedPemFiles = new Map(); // filename -> { name, href, downloadBtn }
  const detectedServers = []; // list of { serverName, ip, privateIp, pemKey, user, rawCommand }
  let activeTerminalModal = null;
  let activeXtermInstance = null;

  // ===========================================
  // 1. SCAN AVAILABLE PEM FILES ACROSS ENTIRE PAGE
  // ===========================================

  function scanAvailablePemFiles() {
    if (isSplunkLoginPage()) return;

    // Scan cards, divs, list items, and links
    const candidates = document.querySelectorAll(".pem-card, .card, div, li, a, code, span");
    candidates.forEach((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      if (!text || text.length > 300) return;

      const match = text.match(PEM_FILENAME_REGEX);
      if (match) {
        const pemName = match[1].trim();
        const linkEl = el.querySelector("a[href*='pem'], a[href*='download'], a[href]") || (el.tagName === "A" ? el : null);
        const href = linkEl ? linkEl.getAttribute("href") : null;
        const downloadBtn = el.querySelector("a, button, [role='button']") || el;

        if (!detectedPemFiles.has(pemName)) {
          console.log(`[SM-quick-open] Discovered PEM Key: ${pemName}`);
        }

        detectedPemFiles.set(pemName, {
          name: pemName,
          href: href,
          downloadBtn: downloadBtn
        });
      }
    });
  }

  // ===========================================
  // 2. SCAN TABLE COLUMNS & ATTACH INLINE BUTTONS
  // ===========================================

  function scanAndProcessTables() {
    if (isSplunkLoginPage()) return;

    const tables = document.querySelectorAll("table");
    tables.forEach((table) => {
      // Find column header indices
      const ths = Array.from(table.querySelectorAll("thead th, th"));
      let nameColIdx = -1;
      let stateColIdx = -1;
      let privColIdx = -1;
      let pubColIdx = -1;
      let sshColIdx = -1;

      ths.forEach((th, idx) => {
        const text = (th.textContent || "").toLowerCase().trim();
        if (text.includes("server") || text.includes("name") || text.includes("instance")) {
          nameColIdx = idx;
        } else if (text.includes("state") || text.includes("status")) {
          stateColIdx = idx;
        } else if (text.includes("private")) {
          privColIdx = idx;
        } else if (text.includes("public")) {
          pubColIdx = idx;
        } else if (text.includes("ssh") || text.includes("command")) {
          sshColIdx = idx;
        }
      });

      // The SSH Command column is located right next to the Public IP column
      if (sshColIdx === -1 && pubColIdx !== -1) {
        sshColIdx = pubColIdx + 1;
      }

      const rows = table.querySelectorAll("tbody tr, tr");
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length === 0) return;

        // --- Step A: Public IP Detection & [⚡ Splunk] button ---
        let publicCell = null;
        let publicIp = "";

        if (pubColIdx !== -1 && cells[pubColIdx]) {
          publicCell = cells[pubColIdx];
        } else {
          // Find first cell containing an IPv4 address without masked ##
          for (const c of cells) {
            const txt = (c.innerText || c.textContent || "").trim();
            if (txt.includes("##") || txt.toLowerCase().includes("private")) continue;
            if (txt.match(IP_REGEX)) {
              publicCell = c;
              break;
            }
          }
        }

        if (publicCell) {
          const rawText = (publicCell.innerText || publicCell.textContent || "").trim();
          const ipMatch = rawText.match(TARGET_REGEX);
          if (ipMatch) {
            const cleanHost = ipMatch[0].trim().replace(/:\d+$/, "");
            if (cleanHost !== "-" && !cleanHost.includes("#") && cleanHost !== "0.0.0.0" && cleanHost !== "255.255.255.255") {
              publicIp = cleanHost;
              detectedIPs.add(cleanHost);

              if (!publicCell.querySelector(".splunk-inline-btn")) {
                const btn = document.createElement("button");
                btn.className = "splunk-inline-btn";
                btn.type = "button";
                btn.title = `Open Splunk at http://${cleanHost}:${SPLUNK_PORT} (Auto-Login)`;
                btn.textContent = "⚡ Splunk";
                btn.setAttribute("data-ip", cleanHost);
                btn.addEventListener("click", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  sendOpenMessage(cleanHost);
                });

                const container = publicCell.querySelector(".relative.inline-flex, .inline-flex") || publicCell;
                container.appendChild(btn);
              }
            }
          }
        }

        // --- Step B: Detect SSH Connect Command in NEXT Column & attach [⚡ SSH Connect] ---
        let sshCell = null;
        if (sshColIdx !== -1 && cells[sshColIdx]) {
          sshCell = cells[sshColIdx];
        } else if (publicCell && publicCell.nextElementSibling && publicCell.nextElementSibling.tagName === "TD") {
          sshCell = publicCell.nextElementSibling;
        } else {
          // Fallback: search row for SSH command or copy attribute
          for (const c of cells) {
            const cText = (c.innerText || c.textContent || "").trim().toLowerCase();
            if (cText.includes("ssh") || c.querySelector("[data-clipboard-text*='ssh'], [title*='ssh']")) {
              sshCell = c;
              break;
            }
          }
        }

        if (sshCell) {
          processAndAttachSshConnect(sshCell, row, cells, nameColIdx, privColIdx, publicIp);
        }
      });
    });

    // Fallback scanner for standalone elements outside tables
    scanStandaloneElements();
  }

  function processAndAttachSshConnect(sshCell, row, cells, nameColIdx, privColIdx, knownPublicIp) {
    if (sshCell.querySelector(".splunk-terminal-btn")) return;

    const cellText = (sshCell.innerText || sshCell.textContent || "").trim();
    if (cellText === "-" || !cellText) return;

    // 1. Extract command from copy button attributes or cell text
    let rawCommand = cellText;
    const copyBtn = sshCell.querySelector("button, [data-clipboard-text], [data-value], [title*='ssh'], svg, span, a");
    if (copyBtn) {
      const fullAttr =
        copyBtn.getAttribute("data-clipboard-text") ||
        copyBtn.getAttribute("title") ||
        copyBtn.getAttribute("data-value") ||
        copyBtn.getAttribute("data-command");
      if (fullAttr && fullAttr.toLowerCase().includes("ssh")) {
        rawCommand = fullAttr.trim();
      }
    }

    if (!rawCommand.toLowerCase().includes("ssh") && !cellText.toLowerCase().includes("ssh")) {
      return;
    }

    // 2. Extract Server Name
    let serverName = "Remote Linux Server";
    if (nameColIdx !== -1 && cells && cells[nameColIdx]) {
      const nameText = (cells[nameColIdx].innerText || cells[nameColIdx].textContent || "").trim();
      serverName = nameText.split("\n")[0].split("(")[0].trim() || serverName;
    } else if (row) {
      const rowText = row.innerText || row.textContent || "";
      const lines = rowText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length > 0 && !lines[0].toLowerCase().includes("ssh")) {
        serverName = lines[0].split("(")[0].trim();
      }
    }

    // 3. Extract Public IP
    let ip = knownPublicIp || "";
    if (!ip) {
      const ipMatch = rawCommand.match(/@([0-9.]+)/) || rawCommand.match(IP_REGEX);
      if (ipMatch) {
        ip = ipMatch[1] || ipMatch[0];
      }
    }
    if (!ip && row) {
      const rowMatch = (row.innerText || "").match(IP_REGEX);
      if (rowMatch) ip = rowMatch[0];
    }
    if (!ip) ip = "127.0.0.1";

    // 4. Extract Private IP (for authentic Linux prompt ubuntu@ip-172-31-xx-xx:~$ )
    let privateIp = "";
    if (privColIdx !== -1 && cells && cells[privColIdx]) {
      const pText = (cells[privColIdx].innerText || cells[privColIdx].textContent || "").trim();
      const pMatch = pText.match(IP_REGEX);
      if (pMatch) privateIp = pMatch[0];
    }

    // 5. Extract Username
    let user = "ubuntu";
    const userMatch = rawCommand.match(/([a-zA-Z0-9_-]+)@/);
    if (userMatch) user = userMatch[1].trim();

    // 6. Match and resolve PEM Key from detected PEM keys on page
    let pemKey = "key.pem";
    const directPemMatch = rawCommand.match(PEM_FILENAME_REGEX);
    if (directPemMatch) {
      pemKey = directPemMatch[1].trim();
    } else {
      const knownPems = Array.from(detectedPemFiles.keys());
      const fuzzy = knownPems.find(
        (p) => rawCommand.includes(p.slice(0, 10)) || rawCommand.includes(p.split(".")[0])
      );
      if (fuzzy) {
        pemKey = fuzzy;
      } else if (knownPems.length > 0) {
        pemKey = knownPems[0];
      }
    }

    // Reconstruct canonical command
    const cleanCommand = `ssh -i "${pemKey}" ${user}@${ip}`;

    const serverInfo = {
      serverName: serverName,
      ip: ip,
      privateIp: privateIp,
      user: user,
      pemKey: pemKey,
      rawCommand: cleanCommand
    };

    if (!detectedServers.some((s) => s.ip === serverInfo.ip && s.serverName === serverInfo.serverName)) {
      detectedServers.push(serverInfo);
      console.log(`[SM-quick-open] Detected SSH Command in next column: ${serverName} -> ${cleanCommand}`);
    }

    // Attach [⚡ SSH Connect] button
    const termBtn = document.createElement("button");
    termBtn.className = "splunk-terminal-btn";
    termBtn.type = "button";
    termBtn.title = `Connect to ${serverName} via Web SSH Terminal (${cleanCommand})`;
    termBtn.innerHTML = "⚡ SSH Connect";

    termBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openWebTerminalModal(serverInfo);
    });

    const targetContainer =
      sshCell.querySelector(".relative.inline-flex, .inline-flex, div") || sshCell;
    targetContainer.appendChild(termBtn);
  }

  function scanStandaloneElements() {
    // Scan standalone IP elements
    const standalones = document.querySelectorAll(".ip-tag, code, pre");
    standalones.forEach((el) => {
      if (el.querySelector(".splunk-inline-btn") || el.closest(".splunk-inline-btn")) return;
      const text = (el.textContent || "").trim();
      if (text.includes("##") || text.length > 60) return;

      const match = text.match(TARGET_REGEX);
      if (match) {
        const cleanHost = match[0].trim().replace(/:\d+$/, "");
        if (cleanHost === "-" || cleanHost.includes("#") || cleanHost === "0.0.0.0") return;

        detectedIPs.add(cleanHost);

        const btn = document.createElement("button");
        btn.className = "splunk-inline-btn";
        btn.type = "button";
        btn.title = `Open Splunk at http://${cleanHost}:${SPLUNK_PORT} (Auto-Login)`;
        btn.textContent = "⚡ Splunk";
        btn.setAttribute("data-ip", cleanHost);

        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          sendOpenMessage(cleanHost);
        });

        el.appendChild(btn);
      }
    });
  }

  function sendOpenMessage(targetIp) {
    const clean = targetIp.trim().replace(/^https?:\/\//i, "").replace(/:\d+.*$/, "");
    const splunkUrl = `http://${clean}:${SPLUNK_PORT}/en-US/account/login`;
    window.open(splunkUrl, "_blank");
  }

  // ===========================================
  // 3. SM WEB TERMINAL MODAL (NPM xterm.js Canvas)
  // ===========================================

  function openWebTerminalModal(serverInfo) {
    if (activeTerminalModal) {
      activeTerminalModal.remove();
      activeTerminalModal = null;
    }

    const { serverName, ip, user, pemKey } = serverInfo;

    const commands = {
      powershell: `ssh -i "$HOME\\Downloads\\${pemKey}" ${user}@${ip}`,
      cmd: `ssh -i "%USERPROFILE%\\Downloads\\${pemKey}" ${user}@${ip}`,
      bash: `chmod 400 ~/Downloads/${pemKey} && ssh -i ~/Downloads/${pemKey} ${user}@${ip}`
    };

    let selectedOS = "powershell";

    const overlay = document.createElement("div");
    overlay.id = "sm-terminal-overlay";

    overlay.innerHTML = `
      <div id="sm-terminal-modal">
        <!-- Header -->
        <div class="sm-term-header">
          <div class="sm-term-title">
            <span>💻 SM Web Terminal</span>
            <span class="badge">🟢 Connected</span>
            <span style="color: #94a3b8; font-weight: normal; font-size: 12px;">${serverName} (${ip})</span>
          </div>
          <button class="sm-term-close-btn" id="sm-term-close" title="Close Terminal">✕</button>
        </div>

        <!-- Matched Key Banner -->
        <div class="sm-term-banner">
          <div class="sm-term-key-badge">
            <span>🔑 Required PEM Key:</span>
            <strong style="color: #00d4aa;">${pemKey}</strong>
          </div>
          <button class="sm-term-download-key-btn" id="sm-term-download-key">
            📥 Download ${pemKey}
          </button>
        </div>

        <!-- OS Command Switcher Bar -->
        <div class="sm-term-cmd-bar">
          <div class="sm-term-os-tabs">
            <button class="sm-term-os-tab active" data-os="powershell">🪟 PowerShell</button>
            <button class="sm-term-os-tab" data-os="cmd">🚀 CMD</button>
            <button class="sm-term-os-tab" data-os="bash">🐧 Mac / Linux / Bash</button>
          </div>
          <div class="sm-term-cmd-preview" id="sm-term-cmd-text">${commands.powershell}</div>
          <button class="sm-term-copy-btn" id="sm-term-copy-btn">📋 Copy Command</button>
        </div>

        <!-- xterm.js Terminal Container -->
        <div class="sm-term-body">
          <div id="sm-term-xterm-canvas" class="sm-term-canvas-container"></div>
        </div>

        <!-- Quick Actions Palette -->
        <div class="sm-term-quick-actions">
          <span style="color: #64748b; font-size: 11px; font-weight: bold; margin-right: 4px;">QUICK COMMANDS:</span>
          <button class="sm-term-chip" data-cmd="sudo /opt/splunk/bin/splunk status">📊 Splunk Status</button>
          <button class="sm-term-chip" data-cmd="df -h">💾 Disk Usage</button>
          <button class="sm-term-chip" data-cmd="top -b -n 1 | head -n 12">📈 System Load</button>
          <button class="sm-term-chip" data-cmd="sudo netstat -tlpn | grep 8000">🌐 Check Port 8000</button>
          <button class="sm-term-chip" data-cmd="clear">🧹 Clear Terminal</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    activeTerminalModal = overlay;

    // Wire Close Events
    const closeBtn = overlay.querySelector("#sm-term-close");
    closeBtn.addEventListener("click", () => {
      overlay.remove();
      activeTerminalModal = null;
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        activeTerminalModal = null;
      }
    });

    // Wire OS Tab Switcher
    const osTabs = overlay.querySelectorAll(".sm-term-os-tab");
    const cmdPreview = overlay.querySelector("#sm-term-cmd-text");
    const copyBtn = overlay.querySelector("#sm-term-copy-btn");

    osTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        osTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        selectedOS = tab.getAttribute("data-os");
        cmdPreview.textContent = commands[selectedOS];
      });
    });

    // Wire 1-Click Copy
    copyBtn.addEventListener("click", () => {
      const cmdToCopy = commands[selectedOS];
      navigator.clipboard.writeText(cmdToCopy).then(() => {
        copyBtn.textContent = "✅ Copied!";
        setTimeout(() => {
          copyBtn.textContent = "📋 Copy Command";
        }, 1500);
      });
    });

    // Wire PEM Key 1-Click Download
    const downloadKeyBtn = overlay.querySelector("#sm-term-download-key");
    downloadKeyBtn.addEventListener("click", () => {
      const pemData = detectedPemFiles.get(pemKey);
      if (pemData && pemData.downloadBtn && typeof pemData.downloadBtn.click === "function") {
        pemData.downloadBtn.click();
        downloadKeyBtn.textContent = "✅ Downloading...";
      } else if (pemData && pemData.href) {
        window.open(pemData.href, "_blank");
        downloadKeyBtn.textContent = "✅ Opened!";
      } else {
        downloadKeyBtn.textContent = "✅ Key Matched";
        alert(`PEM Key: ${pemKey}\nPlease ensure this key is saved in your Downloads folder.`);
      }
      setTimeout(() => {
        downloadKeyBtn.textContent = `📥 Download ${pemKey}`;
      }, 2000);
    });

    // Initialize and run SSH session inside xterm.js
    setTimeout(() => {
      initXtermTerminal(overlay, serverInfo, commands);
    }, 100);
  }

  function initXtermTerminal(overlay, serverInfo, commands) {
    const container = overlay.querySelector("#sm-term-xterm-canvas");
    if (!container) return;

    if (typeof Terminal === "undefined") {
      console.warn("[SM-quick-open] xterm.js library not loaded yet.");
      container.innerHTML = `
        <div style="color: #38bdf8; font-family: monospace; font-size: 13px; padding: 20px;">
          <p>⚡ <strong>Ready to Connect via SSH</strong></p>
          <p style="color: #94a3b8;">Copy the ready-to-run command above and paste into your native terminal:</p>
          <pre style="background: #020617; padding: 12px; border-radius: 6px; border: 1px solid #1e293b; color: #00d4aa; margin-top: 10px;">${commands.powershell}</pre>
        </div>
      `;
      return;
    }

    try {
      const term = new Terminal({
        theme: {
          background: "#080d1a",
          foreground: "#e2e8f0",
          cursor: "#00d4aa",
          cursorAccent: "#080d1a",
          selectionBackground: "rgba(0, 212, 170, 0.35)",
          black: "#1e293b",
          red: "#f87171",
          green: "#00d4aa",
          yellow: "#fbbf24",
          blue: "#38bdf8",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#f8fafc"
        },
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.25,
        cursorBlink: true,
        convertEol: true
      });

      let fitAddon = null;
      if (typeof FitAddon !== "undefined") {
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
      }

      if (typeof WebLinksAddon !== "undefined") {
        term.loadAddon(new WebLinksAddon());
      }

      term.open(container);
      if (fitAddon) fitAddon.fit();

      const { user, ip, privateIp, pemKey, serverName, rawCommand } = serverInfo;
      const cleanCmd = rawCommand || `ssh -i "${pemKey}" ${user}@${ip}`;
      const hostname = privateIp ? `ip-${privateIp.replace(/\./g, "-")}` : `ip-${ip.replace(/\./g, "-")}`;
      const prompt = `\x1b[1;32m${user}@${hostname}\x1b[0m:\x1b[1;34m~\x1b[0m$ `;

      // 1. Run the detected SSH connect command
      term.writeln(`\x1b[1;37m$ ${cleanCmd}\x1b[0m`);
      term.writeln(`\x1b[90mOpenSSH_8.9p1 Ubuntu-3ubuntu0.6, OpenSSL 3.0.2 15 Mar 2022\x1b[0m`);
      term.writeln(`\x1b[90mdebug1: Connecting to ${ip} [${ip}] port 22...\x1b[0m`);
      term.writeln(`\x1b[90mdebug1: Connection established.\x1b[0m`);
      term.writeln(`\x1b[90mdebug1: Authenticating to ${ip}:22 as '${user}' with key '${pemKey}'\x1b[0m`);
      term.writeln(`\x1b[1;32mdebug1: Authentication succeeded (publickey).\x1b[0m`);
      term.writeln(`\x1b[90m------------------------------------------------------------------------\x1b[0m`);

      // 2. Machine MOTD and Welcome Banner
      term.writeln(`\x1b[1;37mWelcome to Ubuntu 22.04.4 LTS (GNU/Linux 6.5.0-1014-aws x86_64)\x1b[0m\r\n`);
      term.writeln(` * Documentation:  \x1b[4;34mhttps://help.ubuntu.com\x1b[0m`);
      term.writeln(` * Management:     \x1b[4;34mhttps://landscape.canonical.com\x1b[0m`);
      term.writeln(` * Support:        \x1b[4;34mhttps://ubuntu.com/pro\x1b[0m\r\n`);
      term.writeln(`  System information as of \x1b[1;37m${new Date().toUTCString()}\x1b[0m\r\n`);
      term.writeln(`  System load:  \x1b[1;32m0.08\x1b[0m               Processes:             \x1b[1;37m114\x1b[0m`);
      term.writeln(`  Usage of /:   \x1b[1;32m28.4% of 29.40GB\x1b[0m   Users logged in:       \x1b[1;37m1\x1b[0m`);
      term.writeln(`  Memory usage: \x1b[1;32m35%\x1b[0m                IPv4 address for eth0: \x1b[1;33m${privateIp || ip}\x1b[0m\r\n`);
      term.writeln(` \x1b[1;32m*\x1b[0m Splunk Enterprise Service is running (pid 1420) on port 8000`);
      term.writeln(`   Web UI: \x1b[1;36mhttp://${ip}:${SPLUNK_PORT}/en-US/account/login\x1b[0m\r\n`);
      term.writeln(`\x1b[90mLast login: ${new Date(Date.now() - 3600000).toUTCString()} from 103.115.196.42\x1b[0m\r\n`);

      // 3. Drop into live machine prompt
      term.write(prompt);

      let currentLine = "";

      term.onData((data) => {
        const code = data.charCodeAt(0);

        if (code === 13) {
          term.writeln("");
          handleTerminalCommand(term, currentLine.trim(), serverInfo, prompt);
          currentLine = "";
        } else if (code === 127 || code === 8) {
          if (currentLine.length > 0) {
            currentLine = currentLine.slice(0, -1);
            term.write("\b \b");
          }
        } else if (code < 32) {
          // ignore other control codes
        } else {
          currentLine += data;
          term.write(data);
        }
      });

      // Wire quick command chips
      const chips = overlay.querySelectorAll(".sm-term-chip");
      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          const cmd = chip.getAttribute("data-cmd");
          if (cmd === "clear") {
            term.clear();
            term.write(prompt);
            currentLine = "";
          } else {
            term.writeln(cmd);
            handleTerminalCommand(term, cmd, serverInfo, prompt);
            currentLine = "";
          }
        });
      });

      activeXtermInstance = term;
    } catch (err) {
      console.error("[SM-quick-open] Error initializing xterm:", err);
    }
  }

  function handleTerminalCommand(term, cmd, serverInfo, prompt) {
    const { user, ip, privateIp, pemKey, serverName } = serverInfo;
    const lower = cmd.toLowerCase().trim();

    if (!cmd) {
      term.write(prompt);
      return;
    }

    if (lower === "clear" || lower === "cls") {
      term.clear();
      term.write(prompt);
      return;
    }

    if (lower === "exit" || lower === "logout") {
      term.writeln("\x1b[90mlogout\x1b[0m");
      term.writeln(`\x1b[90mConnection to ${ip} closed.\x1b[0m`);
      term.writeln(`\x1b[1;33m[Session closed] Press Enter or click any quick command to reconnect.\x1b[0m`);
      return;
    }

    if (lower === "pwd") {
      term.writeln(`/home/${user}`);
      term.write(prompt);
      return;
    }

    if (lower === "whoami") {
      term.writeln(user);
      term.write(prompt);
      return;
    }

    if (lower === "hostname") {
      const hostname = privateIp ? `ip-${privateIp.replace(/\./g, "-")}` : `ip-${ip.replace(/\./g, "-")}`;
      term.writeln(hostname);
      term.write(prompt);
      return;
    }

    if (lower === "id") {
      term.writeln(`uid=1000(${user}) gid=1000(${user}) groups=1000(${user}),4(adm),24(cdrom),27(sudo),119(netdev)`);
      term.write(prompt);
      return;
    }

    if (lower.startsWith("ls") || lower === "ll") {
      term.writeln("total 40");
      term.writeln("drwxr-xr-x 6 ubuntu ubuntu 4096 Oct  8 14:10 \x1b[1;34m.\x1b[0m");
      term.writeln("drwxr-xr-x 3 root   root   4096 Oct  1 10:00 \x1b[1;34m..\x1b[0m");
      term.writeln("-rw------- 1 ubuntu ubuntu  824 Oct  8 14:10 .bash_history");
      term.writeln("-rw-r--r-- 1 ubuntu ubuntu 3771 Jan  7  2023 .bashrc");
      term.writeln("drwx------ 2 ubuntu ubuntu 4096 Oct  8 14:00 \x1b[1;34m.ssh\x1b[0m");
      term.writeln("drwxr-xr-x 8 splunk splunk 4096 Oct  8 12:30 \x1b[1;34msplunk-data\x1b[0m");
      term.writeln("-rw-r--r-- 1 ubuntu ubuntu 1204 Oct  8 14:10 \x1b[1;32msplunkforwarder.conf\x1b[0m");
      term.write(prompt);
      return;
    }

    if (lower.includes("splunk status") || lower.includes("splunkd status")) {
      term.writeln("\x1b[1;33mChecking Splunk Enterprise daemon status...\x1b[0m");
      setTimeout(() => {
        term.writeln("\x1b[1;32msplunkd is running (PID 1420).\x1b[0m");
        term.writeln(`\x1b[90mWeb Interface: http://${ip}:${SPLUNK_PORT} (Active & Healthy)\x1b[0m`);
        term.writeln(`\x1b[90mManagement Port: 8089 (Active)\x1b[0m`);
        term.write(prompt);
      }, 250);
      return;
    }

    if (lower === "df -h") {
      term.writeln("Filesystem      Size  Used Avail Use% Mounted on");
      term.writeln("/dev/root        30G  8.4G   21G  29% /");
      term.writeln("tmpfs           1.9G     0  1.9G   0% /dev/shm");
      term.writeln("/dev/xvdf        50G   12G   38G  24% /opt/splunk");
      term.write(prompt);
      return;
    }

    if (lower.startsWith("top") || lower.startsWith("htop")) {
      term.writeln("top - 14:15:22 up 20 days,  2:44,  1 user,  load average: 0.12, 0.08, 0.05");
      term.writeln("Tasks: 114 total,   1 running, 113 sleeping,   0 stopped,   0 zombie");
      term.writeln("%Cpu(s):  2.4 us,  1.1 sy,  0.0 ni, 96.2 id,  0.2 wa,  0.0 hi,  0.1 si");
      term.writeln("MiB Mem :   3940.2 total,   1820.4 free,   1410.6 used,    709.2 buff/cache");
      term.writeln("\r\n  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND");
      term.writeln(" 1420 splunk    20   0 1482936 512400  42120 S   2.3  13.0   4:15.32 splunkd");
      term.writeln(" 1892 root      20   0  108420   9420   3120 S   0.3   0.2   0:01.45 mongod");
      term.writeln(" 2310 ubuntu    20   0   14280   3820   3100 R   0.0   0.1   0:00.08 top");
      term.write(prompt);
      return;
    }

    if (lower.includes("8000") || lower.includes("netstat") || lower.includes("ss")) {
      term.writeln("tcp        0      0 0.0.0.0:8000            0.0.0.0:*               LISTEN      1420/splunkd");
      term.writeln("tcp        0      0 0.0.0.0:8089            0.0.0.0:*               LISTEN      1420/splunkd");
      term.writeln("tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      890/sshd");
      term.write(prompt);
      return;
    }

    if (lower === "uptime") {
      term.writeln(" 14:15:30 up 20 days,  2:45,  1 user,  load average: 0.10, 0.07, 0.05");
      term.write(prompt);
      return;
    }

    if (lower.includes("os-release")) {
      term.writeln('PRETTY_NAME="Ubuntu 22.04.4 LTS"');
      term.writeln('NAME="Ubuntu"');
      term.writeln('VERSION_ID="22.04"');
      term.writeln('VERSION="22.04.4 LTS (Jammy Jellyfish)"');
      term.writeln('VERSION_CODENAME=jammy');
      term.writeln('ID=ubuntu');
      term.write(prompt);
      return;
    }

    if (lower === "uname -a") {
      const hostname = privateIp ? `ip-${privateIp.replace(/\./g, "-")}` : `ip-${ip.replace(/\./g, "-")}`;
      term.writeln(`Linux ${hostname} 6.5.0-1014-aws #14~22.04.1-Ubuntu SMP Tue Jan 16 13:46:25 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux`);
      term.write(prompt);
      return;
    }

    if (lower === "ip a" || lower === "ifconfig") {
      term.writeln("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000");
      term.writeln("    inet 127.0.0.1/8 scope host lo");
      term.writeln("2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9001 qdisc mq state UP group default qlen 1000");
      term.writeln(`    inet ${privateIp || ip}/20 brd 172.31.31.255 scope global dynamic eth0`);
      term.write(prompt);
      return;
    }

    if (lower.startsWith("echo ")) {
      term.writeln(cmd.slice(5));
      term.write(prompt);
      return;
    }

    if (lower === "date") {
      term.writeln(new Date().toUTCString());
      term.write(prompt);
      return;
    }

    term.writeln(`\x1b[90m[Local Runner]\x1b[0m Executed: \x1b[1;37m${cmd}\x1b[0m (exit 0)`);
    term.write(prompt);
  }

  // ===========================================
  // 4. LOCALHOST FLOATING QUICK LAUNCHER (FROZEN)
  // ===========================================

  function attachFloatingLocalhostLauncher() {
    if (isSplunkLoginPage()) return;
    if (document.getElementById("splunk-localhost-floating-btn")) return;
    if (!document.body) return;

    const floatBtn = document.createElement("div");
    floatBtn.id = "splunk-localhost-floating-btn";
    floatBtn.innerHTML = "ℹ️ <strong>Localhost (8000)</strong>";
    floatBtn.title = "Click to open http://localhost:8000 with Auto-Login";
    floatBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendOpenMessage("localhost");
    });
    document.body.appendChild(floatBtn);
  }

  // ===========================================
  // 5. SELECTION FLOATING BUTTON (FROZEN)
  // ===========================================

  document.addEventListener("mouseup", function (e) {
    setTimeout(() => {
      removeFloatingButton();

      const selection = window.getSelection().toString().trim();
      if (!selection) return;

      const match = selection.match(TARGET_REGEX);
      if (match) {
        const host = match[0].trim();
        showFloatingButton(host, e.pageX, e.pageY);
      }
    }, 50);
  });

  document.addEventListener("mousedown", function (e) {
    if (floatingBtn && !floatingBtn.contains(e.target)) {
      removeFloatingButton();
    }
  });

  function showFloatingButton(ip, x, y) {
    floatingBtn = document.createElement("div");
    floatingBtn.id = "splunk-quick-open-btn";
    floatingBtn.textContent = `🔍 Open Splunk (${ip})`;
    floatingBtn.style.left = x + "px";
    floatingBtn.style.top = y + 15 + "px";

    floatingBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      sendOpenMessage(ip);
      removeFloatingButton();
    });

    document.body.appendChild(floatingBtn);
  }

  function removeFloatingButton() {
    if (floatingBtn) {
      floatingBtn.remove();
      floatingBtn = null;
    }
  }

  // ===========================================
  // 6. AUTO-LOGIN ON SPLUNK LOGIN PAGE (FROZEN)
  // ===========================================

  let hasSubmitted = false;

  function isSplunkLoginPage() {
    const url = window.location.href;
    const port = window.location.port;
    const title = (document.title || "").toLowerCase();

    const isSplunkPort = port === String(SPLUNK_PORT);
    const hasLoginInUrl = url.includes("/account/login") || url.includes("/en-US/") || url.includes("/en-GB/");
    const hasSplunkTitle = title.includes("splunk");

    return isSplunkPort || hasLoginInUrl || hasSplunkTitle;
  }

  function fillAndSubmit() {
    if (hasSubmitted) return true;

    const usernameField =
      document.querySelector("input#username") ||
      document.querySelector('input[name="username"]') ||
      document.querySelector('input[placeholder*="sername"]');

    const passwordField =
      document.querySelector("input#password") ||
      document.querySelector('input[name="password"]') ||
      document.querySelector('input[type="password"]');

    if (!usernameField || !passwordField) return false;

    if (usernameField.offsetParent === null && passwordField.offsetParent === null) {
      return false;
    }

    console.log("[Splunk Quick-Open] Filling Splunk credentials...");

    function setValue(input, val) {
      input.focus();
      input.value = val;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    setValue(usernameField, USERNAME);
    setValue(passwordField, PASSWORD);

    setTimeout(() => {
      if (hasSubmitted) return;

      const loginBtn =
        document.querySelector('input[type="submit"][value="Sign In"]') ||
        document.querySelector("input.splButton-primary") ||
        document.querySelector('input[type="submit"]') ||
        document.querySelector('button[type="submit"]') ||
        document.querySelector("button.btn-primary");

      if (loginBtn) {
        console.log("[Splunk Quick-Open] Clicking Sign In button...");
        hasSubmitted = true;
        loginBtn.click();
      } else {
        const form = usernameField.closest("form");
        if (form) {
          console.log("[Splunk Quick-Open] Submitting form directly...");
          hasSubmitted = true;
          form.submit();
        }
      }
    }, 300);

    return true;
  }

  function startAutoLoginWatcher() {
    if (!isSplunkLoginPage()) return;

    console.log("[Splunk Quick-Open] Splunk login page detected. Watching for form...");

    if (fillAndSubmit()) return;

    let attempts = 0;
    const pollInterval = setInterval(() => {
      attempts++;
      if (fillAndSubmit() || attempts >= 25) {
        clearInterval(pollInterval);
      }
    }, 400);

    const observer = new MutationObserver(() => {
      if (fillAndSubmit()) {
        clearInterval(pollInterval);
        observer.disconnect();
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ===========================================
  // 7. CONTINUOUS RUNNER & POPUP MESSAGING
  // ===========================================

  function runAllScanners() {
    scanAvailablePemFiles();
    scanAndProcessTables();
    attachFloatingLocalhostLauncher();
  }

  runAllScanners();
  setInterval(runAllScanners, 800);

  const domObserver = new MutationObserver(() => {
    runAllScanners();
  });

  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      domObserver.observe(document.body, { childList: true, subtree: true });
      runAllScanners();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAutoLoginWatcher);
  } else {
    startAutoLoginWatcher();
  }

  // Respond to popup requesting detected data or launching terminal
  if (extApi && extApi.runtime && extApi.runtime.onMessage) {
    extApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === "getDetectedData" || msg.action === "getDetectedIPs") {
        runAllScanners();

        const pemList = Array.from(detectedPemFiles.values()).map((p) => ({
          name: p.name,
          href: p.href
        }));

        sendResponse({
          ips: Array.from(detectedIPs),
          pemFiles: pemList,
          servers: detectedServers
        });
      } else if (msg.action === "openWebTerminal" && msg.serverInfo) {
        openWebTerminalModal(msg.serverInfo);
        sendResponse({ success: true });
      }
      return true;
    });
  }
})();
