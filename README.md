# 🧠 Synapse_GTB — Surgical Black Box & Sentinel Monitor

**Synapse_GTB** is a production-grade, end-to-end surgical monitoring and data integrity system. It combines real-time medical telemetry, depth-aware computer vision, and cryptographic hash chaining to create a "tamper-proof" audit trail for surgical procedures.

---

## 🚀 Deployment Status
The project is officially deployed on **Vercel**!
- 🌎 **Live Production URL**: [synapse-gtb.vercel.app](https://synapse-gtb.vercel.app)

---

## 💡 The Problem & Our Solution
**Problem**: Medical records and surgical videos are often stored in plain files that can be silently altered or corrupted, leading to liability issues and loss of truth.
**Solution**: **Synapse_GTB** creates a **cryptographic seal** for every second of surgery. By linking each frame to the previous one in an immutable hash chain, we ensure that if even one pixel of video or one heartbeat of data changes, the system detects it instantly.

---

## 🔥 Key Features

### 1. **Sentinel Monitoring Dashboard**
- **Vitals Sync**: Real-time heartbeat, core temp, and motion scores synchronized with surgical video.
- **Magnetic Timeline**: Smooth, inertia-based navigation through recorded sessions with event markers.
- **Glassmorphism UI**: High-contrast, accessibility-first design for operating room environments.

### 2. **Cryptographic Integrity Protocol**
- **Hash-Chaining (Layer 1)**: Every telemetry frame contains a SHA-256 hash of `(Data + Previous_Hash)`.
- **Merkle Roots (Layer 2)**: Frames are batched into a Merkle Tree. The resulting "Root Hash" is anchored, providing a single fingerprint for an entire hour of surgery.
- **Interactive Verifier**: A dedicated auditing engine that cross-references the live data against the expected cryptographic signatures.

### 3. **Sentinel Simulations**
- **Tamper Simulation**: Users can intentionally "corrupt" a data point (e.g., changing a heart rate) to see the Sentinel's automated alarm system in action.
- **Root Cause Analysis**: Shows "Expected vs. Actual" hashes to pinpoint exactly where data was compromised.

---

## 🏛 Technical Architecture

### **Backend: Chronos Engine** (`/backend`)
- **Framework**: FastAPI (Async)
- **Storage**: JSON-based persistent manifest system with frame-by-frame binary verification.
- **Security Submodule**: Pure Python implementation of SHA-256 chaining and Merkle Tree logic.
- **Video Logic**: Headless OpenCV for frame extraction and frame-locking.

### **Frontend: Sentinel View** (`/frontend`)
- **Framework**: React 18, Vite
- **Theming**: Tailwind CSS with custom CSS variable mapping for perfect Dark/Light mode support.
- **Animations**: Framer Motion for tree transitions and timeline responsiveness.
- **Charts**: Chart.js with low-latency data polling.

---

## 📡 API Endpoints (Chronos API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Current live session state & last hash. |
| `GET` | `/api/recordings` | List all historical surgical records. |
| `GET` | `/api/stream` | Multi-part MJPEG stream of live surgical view. |
| `POST` | `/api/start` | Initialize a new secure session. |
| `POST` | `/api/verify/{id}` | Execute a full-chain integrity audit. |
| `POST` | `/api/tamper/{id}/{seq}`| Inject a corruption for testing/demo. |

---

## 🚦 Getting Started Locally

### 1. Setup Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.main --with-api
```

### 2. Setup Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 🤝 The Sentinel Promise
**Immutable. Auditor-Ready. Life-Saving.**  
Developed for the **GTBIT Hackathon**, **Synapse_GTB** represents the future of surgical accountability.

---

## 👥 The Team
This project was designed and developed with ❤️ for the **GTBIT Hackathon** by:
- **Ravi Gupta** — Full Stack & Cloud Infrastructure
- **Anjeet Kesari** — Backend Architecture & Security
- **Vidhyadhar Adasul** — Frontend UX & Sentinel Interface

---

## ⚖️ License
© 2026 Synapse GTB Team. All rights reserved.
