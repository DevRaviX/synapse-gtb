# Project_Chronos (GTBIT)

Welcome to the Synapse_GBT project_Chronos! This repository contains tools for medical data analysis, model training, and a specialized "Surgical Black Box" simulation system with a real-time monitoring dashboard.

## Project Structure

- `black box/`: Contains the simulation engine and the real-time dashboard.
- `extract.py`: Script for extracting data from external sources (e.g., MIMIC).
- `train_baseline.py`: Baseline model training implementation.
- `visualize_performance.py`: Tools for evaluating and visualizing model performance.
- `requirements.txt`: Python dependencies.

## Getting Started

### 1. Environment Setup
We recommend using a Python virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Surgical Black Box Simulation
The Black Box system simulates a surgical environment with real-time telemetry hashing and auditing.

#### Run the Simulation Engine:
```bash
cd "black box"
python sentinel_engine.py
```
This will process the video file in `trimmed video/`, generate telemetry, and seal the data with cryptographic hashes in the `output/` directory.

#### Launch the Dashboard:
Open `black box/dashboard/index.html` in any modern web browser. 
- You can select different sessions using the picker.
- Click "PLAY" to sync the video with the telemetry data.
- View real-time vitals, motion scores, and the live cryptographic hash chain.
- Click anomalies in the log to "jump back" and see the context.

### 3. Model Performance Visualization
To see how the models are performing on the test set:
```bash
python visualize_performance.py
```

## For Frontend Development
The frontend is located in `black box/dashboard/`. It uses:
- `index.html`: Structure and layout.
- `style.css`: Premium dark-mode aesthetics.
- `app.js`: Logic for data polling, video sync, and charting (using Chart.js).

Feel free to modify the UI/UX in these files to enhance the project!

## Security and Integrity
The project implements a "Hash Chain" mechanism. Every frame of data is hashed with the previous frame's hash, creating an immutable audit trail that can be verified using the "VERIFY SYSTEM INTEGRITY" button on the dashboard.
