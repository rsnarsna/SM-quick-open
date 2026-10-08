# Contributing to SM-quick-open

Thank you for your interest in improving **SM-quick-open**! We welcome contributions from developers, DevOps engineers, and Splunk enthusiasts worldwide.

---

## 🛠️ Development Setup

1. **Fork and Clone the Repository**:
   ```bash
   git clone https://github.com/rsnarsna/SM-quick-open.git
   cd SM-quick-open
   ```

2. **Load the Extension into Chrome/Edge**:
   - Open `chrome://extensions/` or `edge://extensions/`
   - Enable **Developer mode** (toggle in upper right)
   - Click **Load unpacked** and select the root directory of this repository.

3. **Load in Firefox**:
   - Open `about:debugging#/runtime/this-firefox`
   - Click **Load Temporary Add-on...**
   - Select `manifest.json`.

---

## 🧪 Running Automated E2E Tests

The repository includes end-to-end tests using Playwright:

```bash
pip install playwright pytest
python -m playwright install chromium
python tests/test_extension_e2e.py
```

---

## 📐 Coding Standards & Guidelines

- **Zero Background Worker Dependency**: We prioritize direct DOM and in-tab execution to prevent MV3 service worker sleeping and cross-browser lifecycle issues.
- **Manifest V3 Compatibility**: All code must conform to Manifest V3 specifications.
- **Clean Vanilla JavaScript**: Content scripts avoid heavy frameworks for fast injection performance (< 10ms).
- **Dark & Light Mode**: Ensure any new UI components support both themes using CSS variables and `@media (prefers-color-scheme)`.

---

## 📬 Pull Request Process

1. Create a feature branch: `git checkout -b feature/amazing-feature`.
2. Commit your changes: `git commit -m 'feat: Add amazing feature'`.
3. Push to the branch: `git push origin feature/amazing-feature`.
4. Open a Pull Request on GitHub with a description of the changes and screenshots if UI is modified.

---

## ☕ Support the Project

If you love SM-quick-open, consider giving this repository a ⭐ on GitHub or supporting ongoing development:
- [Buy Me a Coffee](https://buymeacoffee.com/narayanansw)
