// ============================================
// SM-quick-open — Popup Script
// ============================================

document.addEventListener("DOMContentLoaded", () => {
  const ext =
    typeof chrome !== "undefined" && chrome.runtime
      ? chrome
      : typeof browser !== "undefined" && browser.runtime
      ? browser
      : null;

  // Tab Navigation Elements
  const tabBtnSplunk = document.getElementById("tab-btn-splunk");
  const tabBtnSsh = document.getElementById("tab-btn-ssh");
  const paneSplunk = document.getElementById("pane-splunk");
  const paneSsh = document.getElementById("pane-ssh");

  // Splunk Tab Elements
  const container = document.getElementById("ip-list-container");
  const countEl = document.getElementById("ip-count");
  const manualInput = document.getElementById("manual-ip");
  const manualBtn = document.getElementById("manual-open-btn");
  const localhostBtn = document.getElementById("localhost-quick-btn");

  // SSH Tab Elements
  const pemContainer = document.getElementById("pem-list-container");
  const pemCountEl = document.getElementById("pem-count");
  const serverContainer = document.getElementById("server-list-container");
  const serverCountEl = document.getElementById("server-count");

  let currentTabId = null;

  // Tab Switching Logic
  tabBtnSplunk.addEventListener("click", () => {
    tabBtnSplunk.classList.add("active");
    tabBtnSsh.classList.remove("active");
    paneSplunk.classList.add("active");
    paneSsh.classList.remove("active");
  });

  tabBtnSsh.addEventListener("click", () => {
    tabBtnSsh.classList.add("active");
    tabBtnSplunk.classList.remove("active");
    paneSsh.classList.add("active");
    paneSplunk.classList.remove("active");
  });

  function openSplunk(target) {
    if (!target) return;
    const clean = target.trim().replace(/^https?:\/\//i, "").replace(/:\d+.*$/, "");
    const splunkUrl = `http://${clean}:8000/en-US/account/login`;
    if (ext.tabs && ext.tabs.create) {
      ext.tabs.create({ url: splunkUrl });
    } else {
      window.open(splunkUrl, "_blank");
    }
    window.close();
  }

  // Handle manual input
  if (manualBtn && manualInput) {
    manualBtn.addEventListener("click", () => {
      openSplunk(manualInput.value);
    });
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openSplunk(manualInput.value);
    });
  }

  // Handle dedicated Localhost button
  if (localhostBtn) {
    localhostBtn.addEventListener("click", () => {
      openSplunk("localhost");
    });
  }

  function renderIPList(ips) {
    if (!ips || ips.length === 0) {
      container.innerHTML = '<div class="empty-state">No server IPs detected on this page</div>';
      countEl.textContent = "0 found";
      return;
    }

    countEl.textContent = `${ips.length} found`;
    container.innerHTML = "";

    ips.forEach((ip) => {
      const item = document.createElement("div");
      item.className = "list-item";

      const label = document.createElement("span");
      label.className = "item-text";
      label.textContent = ip;

      const btn = document.createElement("button");
      btn.className = "action-btn";
      btn.textContent = "Open Splunk →";
      btn.addEventListener("click", () => openSplunk(ip));

      item.appendChild(label);
      item.appendChild(btn);
      container.appendChild(item);
    });
  }

  function renderPemList(pemFiles) {
    if (!pemFiles || pemFiles.length === 0) {
      pemContainer.innerHTML = '<div class="empty-state">No .pem key files detected on this page</div>';
      pemCountEl.textContent = "0 keys";
      return;
    }

    pemCountEl.textContent = `${pemFiles.length} keys`;
    pemContainer.innerHTML = "";

    pemFiles.forEach((pem) => {
      const item = document.createElement("div");
      item.className = "list-item";

      const label = document.createElement("span");
      label.className = "item-text";
      label.style.color = "#38bdf8";
      label.textContent = pem.name;

      const btn = document.createElement("button");
      btn.className = "action-btn secondary";
      btn.textContent = "📥 Download";
      btn.addEventListener("click", () => {
        if (pem.href) {
          ext.tabs.create({ url: pem.href });
        } else {
          alert(`PEM Key: ${pem.name}\nPlease download from the lab portal section.`);
        }
      });

      item.appendChild(label);
      item.appendChild(btn);
      pemContainer.appendChild(item);
    });
  }

  function renderServerList(servers) {
    if (!servers || servers.length === 0) {
      serverContainer.innerHTML = '<div class="empty-state">No active SSH instances detected</div>';
      serverCountEl.textContent = "0 active";
      return;
    }

    serverCountEl.textContent = `${servers.length} active`;
    serverContainer.innerHTML = "";

    servers.forEach((srv) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.style.flexDirection = "column";
      item.style.alignItems = "flex-start";
      item.style.gap = "6px";

      const topRow = document.createElement("div");
      topRow.style.display = "flex";
      topRow.style.justifyContent = "space-between";
      topRow.style.width = "100%";
      topRow.style.alignItems = "center";

      const title = document.createElement("span");
      title.className = "item-text";
      title.style.color = "#f8fafc";
      title.textContent = `${srv.serverName} (${srv.ip})`;

      const btnGroup = document.createElement("div");
      btnGroup.style.display = "flex";
      btnGroup.style.gap = "6px";

      const connectBtn = document.createElement("button");
      connectBtn.className = "action-btn";
      connectBtn.textContent = "⚡ Connect";
      connectBtn.title = `Launch Web SSH Terminal for ${srv.serverName}`;
      connectBtn.addEventListener("click", () => {
        if (currentTabId && ext.tabs && ext.tabs.sendMessage) {
          ext.tabs.sendMessage(currentTabId, { action: "openWebTerminal", serverInfo: srv }, () => {
            window.close();
          });
        }
      });

      const copyBtn = document.createElement("button");
      copyBtn.className = "action-btn secondary";
      copyBtn.textContent = "📋 Copy";
      copyBtn.title = "Copy SSH Command";
      copyBtn.addEventListener("click", () => {
        const cmd = `ssh -i "$HOME\\Downloads\\${srv.pemKey}" ${srv.user}@${srv.ip}`;
        navigator.clipboard.writeText(cmd).then(() => {
          copyBtn.textContent = "✅ Copied!";
          setTimeout(() => {
            copyBtn.textContent = "📋 Copy";
          }, 1500);
        });
      });

      btnGroup.appendChild(connectBtn);
      btnGroup.appendChild(copyBtn);

      topRow.appendChild(title);
      topRow.appendChild(btnGroup);

      const subRow = document.createElement("div");
      subRow.style.fontSize = "10px";
      subRow.style.color = "#94a3b8";
      subRow.textContent = `🔑 Key: ${srv.pemKey} | User: ${srv.user}`;

      item.appendChild(topRow);
      item.appendChild(subRow);
      serverContainer.appendChild(item);
    });
  }

  // Standalone fallback extraction for active tab
  function inTabExtractData() {
    const results = new Set();
    const text = (document.body ? document.body.innerText : "") + " " + (document.body ? document.body.textContent : "");
    const regex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
    const matches = text.match(regex) || [];

    matches.forEach((ip) => {
      if (ip.includes("#") || ip === "0.0.0.0" || ip === "255.255.255.255") return;
      const parts = ip.split(".").map(Number);
      const isPrivate = parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 127;
      if (!isPrivate) results.add(ip);
    });

    if (/\blocalhost\b/i.test(text)) results.add("localhost");
    return { ips: Array.from(results) };
  }

  // Query active tab
  if (ext && ext.tabs && ext.tabs.query) {
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        renderIPList([]);
        renderPemList([]);
        renderServerList([]);
        return;
      }

      const activeTab = tabs[0];
      currentTabId = activeTab.id;

      ext.tabs.sendMessage(activeTab.id, { action: "getDetectedData" }, (response) => {
        if (!ext.runtime.lastError && response) {
          if (response.ips) renderIPList(response.ips);
          if (response.pemFiles) renderPemList(response.pemFiles);
          if (response.servers) renderServerList(response.servers);
          return;
        }

        // Fallback
        try {
          if (ext.scripting && ext.scripting.executeScript) {
            ext.scripting.executeScript(
              {
                target: { tabId: activeTab.id },
                func: inTabExtractData,
              },
              (results) => {
                if (results && results[0] && results[0].result && results[0].result.ips) {
                  renderIPList(results[0].result.ips);
                } else {
                  renderIPList([]);
                }
                renderPemList([]);
                renderServerList([]);
              }
            );
          } else {
            renderIPList([]);
            renderPemList([]);
            renderServerList([]);
          }
        } catch (err) {
          renderIPList([]);
          renderPemList([]);
          renderServerList([]);
        }
      });
    });
  }
});
