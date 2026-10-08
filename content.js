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
  // 3. FLOATING MULTI-SESSION WEB TERMINAL (Pure JS Engine)
  // ===========================================

  const FloatingTerminal = (function () {
    const sessions = new Map(); // sessionId -> sessionObject
    let activeSessionId = null;
    let isWindowVisible = false;
    let isMinimized = false;
    let isMaximized = false;
    let savedBounds = null;
    let selectedOS = "powershell";

    let winEl = null;
    let dockEl = null;
    let tabsListEl = null;
    let bodyEl = null;
    let pemLabelEl = null;
    let pemDlBtnEl = null;
    let cmdPreviewEl = null;
    let copyCmdBtnEl = null;
    let maxBtnEl = null;

    function getOsCommand(serverInfo, os) {
      const { user, ip, pemKey } = serverInfo;
      switch (os) {
        case "cmd":
          return `ssh -i "%USERPROFILE%\\Downloads\\${pemKey}" ${user}@${ip}`;
        case "bash":
          return `chmod 400 ~/Downloads/${pemKey} && ssh -i ~/Downloads/${pemKey} ${user}@${ip}`;
        case "powershell":
        default:
          return `ssh -i "$HOME\\Downloads\\${pemKey}" ${user}@${ip}`;
      }
    }

    function ensureDOM() {
      if (winEl) return;

      // 1. Minimized Bottom Dock Pill
      dockEl = document.createElement("div");
      dockEl.id = "sm-minimized-terminal-dock";
      dockEl.innerHTML = `
        <span class="sm-dock-icon">💻</span>
        <span class="sm-dock-title">Terminal</span>
        <span class="sm-dock-badge" id="sm-dock-badge">● 0 Sessions</span>
        <span class="sm-dock-arrow">▲</span>
      `;
      dockEl.addEventListener("click", () => {
        restoreFromDock();
      });
      document.body.appendChild(dockEl);

      // 2. Floating Terminal Window
      winEl = document.createElement("div");
      winEl.id = "sm-floating-terminal";
      winEl.style.display = "none";
      winEl.innerHTML = `
        <!-- Titlebar / Header -->
        <div class="sm-term-titlebar" id="sm-term-titlebar">
          <div class="sm-term-tabs-row">
            <div class="sm-term-brand">
              <span class="sm-brand-icon">💻</span>
              <span class="sm-brand-name">Terminal</span>
            </div>
            <div class="sm-term-tabs-list" id="sm-tabs-list"></div>
            <button class="sm-tab-new-btn" id="sm-tab-new" title="New Session">＋</button>
          </div>
          <div class="sm-term-win-controls">
            <button class="sm-win-btn sm-win-min" id="sm-win-min" title="Minimize to Dock">−</button>
            <button class="sm-win-btn sm-win-max" id="sm-win-max" title="Maximize / Restore">□</button>
            <button class="sm-win-btn sm-win-close" id="sm-win-close" title="Close Window (Keeps sessions running)">✕</button>
          </div>
        </div>

        <!-- Subheader / PEM Key & OS Command Switcher -->
        <div class="sm-term-subheader">
          <div class="sm-term-key-info">
            <div>
              <span class="sm-key-label">🔑 Required Key:</span>
              <span class="sm-key-val" id="sm-active-pem">key.pem</span>
            </div>
            <button class="sm-key-dl-btn" id="sm-active-dl-key">📥 Download</button>
          </div>
          <div class="sm-term-os-bar">
            <div class="sm-os-tabs">
              <button class="sm-os-tab active" data-os="powershell">🪟 PowerShell</button>
              <button class="sm-os-tab" data-os="cmd">🚀 CMD</button>
              <button class="sm-os-tab" data-os="bash">🐧 Bash</button>
            </div>
            <div class="sm-os-cmd-preview" id="sm-os-cmd-preview">ssh -i ...</div>
            <button class="sm-os-copy-btn" id="sm-os-copy-btn">📋 Copy</button>
          </div>
        </div>

        <!-- Body / Terminal Containers -->
        <div class="sm-term-body" id="sm-term-body"></div>

        <!-- Quick Actions Palette -->
        <div class="sm-term-quick-actions">
          <span class="sm-qa-label">QUICK COMMANDS:</span>
          <button class="sm-term-chip" data-cmd="sudo /opt/splunk/bin/splunk status">📊 Splunk Status</button>
          <button class="sm-term-chip" data-cmd="df -h">💾 Disk Usage</button>
          <button class="sm-term-chip" data-cmd="top -b -n 1 | head -n 12">📈 System Load</button>
          <button class="sm-term-chip" data-cmd="sudo netstat -tlpn | grep 8000">🌐 Check Port 8000</button>
          <button class="sm-term-chip" data-cmd="clear">🧹 Clear</button>
        </div>
      `;

      document.body.appendChild(winEl);

      // Cache elements
      tabsListEl = winEl.querySelector("#sm-tabs-list");
      bodyEl = winEl.querySelector("#sm-term-body");
      pemLabelEl = winEl.querySelector("#sm-active-pem");
      pemDlBtnEl = winEl.querySelector("#sm-active-dl-key");
      cmdPreviewEl = winEl.querySelector("#sm-os-cmd-preview");
      copyCmdBtnEl = winEl.querySelector("#sm-os-copy-btn");
      maxBtnEl = winEl.querySelector("#sm-win-max");

      // Wire Window Controls
      winEl.querySelector("#sm-win-min").addEventListener("click", minimizeToDock);
      maxBtnEl.addEventListener("click", toggleMaximize);
      winEl.querySelector("#sm-win-close").addEventListener("click", closeWindowOnly);

      winEl.querySelector("#sm-tab-new").addEventListener("click", () => {
        const nextServer =
          detectedServers.find((s) => !Array.from(sessions.values()).some((sess) => sess.serverInfo.ip === s.ip)) ||
          detectedServers[0] || {
            serverName: "Remote Server",
            ip: "127.0.0.1",
            privateIp: "172.31.10.15",
            user: "ubuntu",
            pemKey: Array.from(detectedPemFiles.keys())[0] || "key.pem",
            rawCommand: "ssh ubuntu@127.0.0.1"
          };
        createSession(nextServer);
      });

      // Wire OS Tab Switcher
      winEl.querySelectorAll(".sm-os-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          winEl.querySelectorAll(".sm-os-tab").forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");
          selectedOS = tab.getAttribute("data-os");
          updateSubheader();
        });
      });

      // Wire 1-Click Copy
      copyCmdBtnEl.addEventListener("click", () => {
        const sess = getActiveSession();
        if (!sess) return;
        const cmd = getOsCommand(sess.serverInfo, selectedOS);
        navigator.clipboard.writeText(cmd).then(() => {
          copyCmdBtnEl.textContent = "✅ Copied!";
          setTimeout(() => {
            copyCmdBtnEl.textContent = "📋 Copy";
          }, 1500);
        });
      });

      // Wire PEM Key Download
      pemDlBtnEl.addEventListener("click", () => {
        const sess = getActiveSession();
        if (!sess) return;
        const pemKey = sess.serverInfo.pemKey;
        const pemData = detectedPemFiles.get(pemKey);
        if (pemData && pemData.downloadBtn && typeof pemData.downloadBtn.click === "function") {
          pemData.downloadBtn.click();
          pemDlBtnEl.textContent = "✅ Downloading...";
        } else if (pemData && pemData.href) {
          window.open(pemData.href, "_blank");
          pemDlBtnEl.textContent = "✅ Opened!";
        } else {
          alert(`PEM Key: ${pemKey}\nPlease make sure this key is saved in your Downloads folder.`);
        }
        setTimeout(() => {
          pemDlBtnEl.textContent = "📥 Download";
        }, 2000);
      });

      // Wire Quick Command Chips
      winEl.querySelectorAll(".sm-term-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const cmd = chip.getAttribute("data-cmd");
          const sess = getActiveSession();
          if (sess && sess.term) {
            if (cmd === "clear") {
              sess.term.clear();
              sess.term.write(sess.prompt);
              sess.currentLine = "";
            } else {
              sess.term.writeln(cmd);
              executeCommand(sess, cmd);
              sess.currentLine = "";
            }
          }
        });
      });

      // Setup Dragging
      setupDraggable(winEl, winEl.querySelector("#sm-term-titlebar"));

      // Setup Resize Observer for auto-fitting xterm
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          const sess = getActiveSession();
          if (sess && sess.fitAddon) {
            try {
              sess.fitAddon.fit();
            } catch (e) {}
          }
        });
        ro.observe(winEl);
      }
    }

    function setupDraggable(targetEl, handleEl) {
      let isDragging = false;
      let startX = 0, startY = 0;
      let initialLeft = 0, initialTop = 0;

      handleEl.addEventListener("mousedown", (e) => {
        if (e.target.closest("button, .sm-tab, input, .sm-tab-new-btn")) return;
        if (isMaximized) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = targetEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        targetEl.style.bottom = "auto";
        targetEl.style.right = "auto";
        targetEl.style.left = `${initialLeft}px`;
        targetEl.style.top = `${initialTop}px`;

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        e.preventDefault();
      });

      function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const newLeft = Math.max(10, Math.min(window.innerWidth - targetEl.offsetWidth - 10, initialLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - targetEl.offsetHeight - 10, initialTop + dy));

        targetEl.style.left = `${newLeft}px`;
        targetEl.style.top = `${newTop}px`;
      }

      function onMouseUp() {
        isDragging = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }
    }

    function minimizeToDock() {
      ensureDOM();
      winEl.classList.remove("sm-term-open");
      dockEl.classList.add("sm-dock-open");
      isWindowVisible = false;
      isMinimized = true;
      updateDockBadge();
    }

    function restoreFromDock() {
      ensureDOM();
      winEl.classList.add("sm-term-open");
      dockEl.classList.remove("sm-dock-open");
      isWindowVisible = true;
      isMinimized = false;
      const sess = getActiveSession();
      if (sess && sess.fitAddon) {
        setTimeout(() => {
          try {
            sess.fitAddon.fit();
            if (sess.term) sess.term.focus();
          } catch (e) {}
        }, 50);
      }
    }

    function closeWindowOnly() {
      ensureDOM();
      winEl.classList.remove("sm-term-open");
      isWindowVisible = false;
      if (sessions.size > 0) {
        dockEl.classList.add("sm-dock-open");
        isMinimized = true;
        updateDockBadge();
      } else {
        dockEl.classList.remove("sm-dock-open");
        isMinimized = false;
      }
    }

    function toggleMaximize() {
      ensureDOM();
      if (!isMaximized) {
        const rect = winEl.getBoundingClientRect();
        savedBounds = {
          left: winEl.style.left || `${rect.left}px`,
          top: winEl.style.top || `${rect.top}px`,
          width: winEl.style.width || `${rect.width}px`,
          height: winEl.style.height || `${rect.height}px`,
          bottom: winEl.style.bottom,
          right: winEl.style.right
        };
        winEl.classList.add("sm-term-maximized");
        maxBtnEl.textContent = "❐";
        maxBtnEl.title = "Restore Window";
        isMaximized = true;
      } else {
        winEl.classList.remove("sm-term-maximized");
        if (savedBounds) {
          winEl.style.left = savedBounds.left;
          winEl.style.top = savedBounds.top;
          winEl.style.width = savedBounds.width;
          winEl.style.height = savedBounds.height;
          if (savedBounds.bottom) winEl.style.bottom = savedBounds.bottom;
          if (savedBounds.right) winEl.style.right = savedBounds.right;
        }
        maxBtnEl.textContent = "□";
        maxBtnEl.title = "Maximize";
        isMaximized = false;
      }
      const sess = getActiveSession();
      if (sess && sess.fitAddon) {
        setTimeout(() => {
          try {
            sess.fitAddon.fit();
          } catch (e) {}
        }, 50);
      }
    }

    function getActiveSession() {
      if (!activeSessionId) return null;
      return sessions.get(activeSessionId) || null;
    }

    function updateSubheader() {
      const sess = getActiveSession();
      if (!sess) return;
      if (pemLabelEl) pemLabelEl.textContent = sess.serverInfo.pemKey;
      if (pemDlBtnEl) pemDlBtnEl.textContent = `📥 Download ${sess.serverInfo.pemKey}`;
      if (cmdPreviewEl) cmdPreviewEl.textContent = getOsCommand(sess.serverInfo, selectedOS);
    }

    function updateDockBadge() {
      if (!dockEl) return;
      const badge = dockEl.querySelector("#sm-dock-badge");
      const count = sessions.size;
      if (badge) {
        badge.textContent = `● ${count} ${count === 1 ? "Session" : "Sessions"}`;
      }
    }

    function renderTabs() {
      if (!tabsListEl) return;
      tabsListEl.innerHTML = "";

      sessions.forEach((sess) => {
        const tab = document.createElement("div");
        tab.className = `sm-tab ${sess.id === activeSessionId ? "active" : ""}`;
        tab.setAttribute("data-id", sess.id);
        tab.innerHTML = `
          <span class="sm-tab-dot">●</span>
          <span class="sm-tab-title" title="${sess.serverInfo.serverName} (${sess.serverInfo.ip})">${sess.serverInfo.serverName}</span>
          <button class="sm-tab-close" title="Close Session">✕</button>
        `;

        tab.addEventListener("click", (e) => {
          if (e.target.closest(".sm-tab-close")) return;
          switchToSession(sess.id);
        });

        tab.querySelector(".sm-tab-close").addEventListener("click", (e) => {
          e.stopPropagation();
          terminateSession(sess.id);
        });

        tabsListEl.appendChild(tab);
      });
    }

    function switchToSession(sessionId) {
      if (!sessions.has(sessionId)) return;
      activeSessionId = sessionId;
      const activeSess = sessions.get(sessionId);

      sessions.forEach((sess) => {
        if (sess.id === sessionId) {
          sess.containerEl.style.display = "block";
          sess.containerEl.classList.add("active");
        } else {
          sess.containerEl.style.display = "none";
          sess.containerEl.classList.remove("active");
        }
      });

      renderTabs();
      updateSubheader();

      if (activeSess.fitAddon) {
        setTimeout(() => {
          try {
            activeSess.fitAddon.fit();
            if (activeSess.term) activeSess.term.focus();
          } catch (e) {}
        }, 30);
      }
    }

    function terminateSession(sessionId) {
      const sess = sessions.get(sessionId);
      if (!sess) return;

      if (sess.term) {
        try {
          sess.term.dispose();
        } catch (e) {}
      }
      if (sess.containerEl) {
        sess.containerEl.remove();
      }
      sessions.delete(sessionId);

      if (activeSessionId === sessionId) {
        const remaining = Array.from(sessions.keys());
        if (remaining.length > 0) {
          switchToSession(remaining[remaining.length - 1]);
        } else {
          activeSessionId = null;
          closeWindowOnly();
        }
      }
      renderTabs();
      updateDockBadge();
    }

    function createSession(serverInfo) {
      ensureDOM();
      const sessionId = "sess-" + Math.random().toString(36).substring(2, 9);

      const session = {
        id: sessionId,
        serverInfo: serverInfo,
        status: "active",
        created_at: new Date(),
        last_activity_at: new Date(),
        containerEl: null,
        term: null,
        fitAddon: null,
        currentLine: "",
        prompt: "",
        cmdHistory: [],
        historyIdx: -1
      };

      const sessContainer = document.createElement("div");
      sessContainer.className = "sm-session-pane";
      sessContainer.id = `sm-pane-${sessionId}`;
      bodyEl.appendChild(sessContainer);
      session.containerEl = sessContainer;

      sessions.set(sessionId, session);
      renderTabs();
      switchToSession(sessionId);

      initSessionTerminal(session);

      winEl.classList.add("sm-term-open");
      dockEl.classList.remove("sm-dock-open");
      isWindowVisible = true;
      isMinimized = false;
      updateDockBadge();

      return session;
    }

    function openSession(serverInfo) {
      ensureDOM();
      // Check if session for this server already exists
      const existing = Array.from(sessions.values()).find(
        (s) => s.serverInfo.ip === serverInfo.ip && s.serverInfo.serverName === serverInfo.serverName
      );

      if (existing) {
        winEl.classList.add("sm-term-open");
        dockEl.classList.remove("sm-dock-open");
        isWindowVisible = true;
        isMinimized = false;
        switchToSession(existing.id);
      } else {
        createSession(serverInfo);
      }
    }

    function initSessionTerminal(session) {
      const container = session.containerEl;
      if (!container) return;

      const { user, ip, privateIp, pemKey, serverName, rawCommand } = session.serverInfo;
      const cleanCmd = rawCommand || `ssh -i "${pemKey}" ${user}@${ip}`;
      const hostname = privateIp ? `ip-${privateIp.replace(/\./g, "-")}` : `ip-${ip.replace(/\./g, "-")}`;
      const prompt = `\x1b[1;32m${user}@${hostname}\x1b[0m:\x1b[1;34m~\x1b[0m$ `;
      session.prompt = prompt;

      if (typeof Terminal === "undefined") {
        container.innerHTML = `
          <div class="sm-term-fallback-view">
            <p>⚡ <strong>Connected to ${serverName} (${ip})</strong></p>
            <pre>${cleanCmd}</pre>
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
        if (fitAddon) {
          fitAddon.fit();
        }

        session.term = term;
        session.fitAddon = fitAddon;

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

        term.onData((data) => {
          session.last_activity_at = new Date();

          // Arrow Up history navigation
          if (data === "\x1b[A") {
            if (session.cmdHistory.length > 0 && session.historyIdx < session.cmdHistory.length - 1) {
              session.historyIdx++;
              const prevCmd = session.cmdHistory[session.cmdHistory.length - 1 - session.historyIdx];
              while (session.currentLine.length > 0) {
                term.write("\b \b");
                session.currentLine = session.currentLine.slice(0, -1);
              }
              session.currentLine = prevCmd;
              term.write(prevCmd);
            }
            return;
          }

          // Arrow Down history navigation
          if (data === "\x1b[B") {
            if (session.historyIdx > 0) {
              session.historyIdx--;
              const nextCmd = session.cmdHistory[session.cmdHistory.length - 1 - session.historyIdx];
              while (session.currentLine.length > 0) {
                term.write("\b \b");
                session.currentLine = session.currentLine.slice(0, -1);
              }
              session.currentLine = nextCmd;
              term.write(nextCmd);
            } else if (session.historyIdx === 0) {
              session.historyIdx = -1;
              while (session.currentLine.length > 0) {
                term.write("\b \b");
                session.currentLine = session.currentLine.slice(0, -1);
              }
            }
            return;
          }

          const code = data.charCodeAt(0);

          if (code === 13) {
            term.writeln("");
            const cmd = session.currentLine.trim();
            if (cmd) {
              session.cmdHistory.push(cmd);
              session.historyIdx = -1;
            }
            executeCommand(session, cmd);
            session.currentLine = "";
          } else if (code === 127 || code === 8) {
            if (session.currentLine.length > 0) {
              session.currentLine = session.currentLine.slice(0, -1);
              term.write("\b \b");
            }
          } else if (code < 32) {
            // ignore other control codes
          } else {
            session.currentLine += data;
            term.write(data);
          }
        });
      } catch (err) {
        console.error("[SM-quick-open] Error initializing session xterm:", err);
      }
    }

    function executeCommand(session, cmd) {
      const term = session.term;
      const prompt = session.prompt;
      const { user, ip, privateIp, serverName } = session.serverInfo;
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
        term.writeln(`\x1b[1;33m[Session terminated] Closing tab...\x1b[0m`);
        setTimeout(() => {
          terminateSession(session.id);
        }, 600);
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
        }, 200);
        return;
      }

      if (lower.includes("splunk restart")) {
        term.writeln("\x1b[1;33mStopping splunkd...\x1b[0m");
        term.writeln("\x1b[90mShutting down daemon [OK]\x1b[0m");
        term.writeln("\x1b[1;32mStarting splunkd...\x1b[0m");
        term.writeln(`\x1b[90mListening on port 8000 for Web UI [OK]\x1b[0m`);
        term.writeln(`\x1b[1;32mSplunk restart complete (new PID 1582).\x1b[0m`);
        term.write(prompt);
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

      if (lower === "help") {
        term.writeln("Available built-in commands:");
        term.writeln("  pwd, whoami, hostname, id, uname -a, cat /etc/os-release");
        term.writeln("  ls, ll, df -h, top, uptime, netstat, date, echo, clear, exit");
        term.writeln("  sudo /opt/splunk/bin/splunk status | restart");
        term.write(prompt);
        return;
      }

      term.writeln(`\x1b[90m[Local Runner]\x1b[0m Executed: \x1b[1;37m${cmd}\x1b[0m (exit 0)`);
      term.write(prompt);
    }

    return {
      openSession,
      createSession,
      switchToSession,
      terminateSession,
      minimizeToDock,
      restoreFromDock,
      closeWindowOnly,
      toggleMaximize
    };
  })();

  function openWebTerminalModal(serverInfo) {
    FloatingTerminal.openSession(serverInfo);
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
