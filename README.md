# Devin-Pantheon: The Agent Brain

This repository serves as the persistent memory, identity, and configuration hub for **Devin**, an AI voice intake and dispatch agent for **CarSpa**, Simon Onabanjo's mobile car detailing business in Lethbridge, AB.

## 🚀 How to Spin Up Devin
In any new Manus session, simply say:
> "Connect to my GitHub, clone `Supremeesimon/Devin-Pantheon`, and run `python3 bootstrap.py` to initiate Devin."

## 🧠 Core Components
- **`IDENTITY.md`**: Defines Devin's persona and greeting.
- **`bootstrap.py`**: The initialization script that loads memory and API keys.
- **`config/`**: Secure storage for Synthflow and Manus API credentials.
- **`memory/`**: Persistent logs of customers, calls, and agent designs.
- **`state.md`**: The current operational status of CarSpa's automation.
- **`goals.md`** / **`tasks.md`**: Current mission objectives and task tracking.

## 📦 Archived: Car Brokerage Pilot
Devin's original scope was a Kijiji-based car brokerage agent (persona "Sarah", finder's-fee model). That line of business is paused. Its scripts and memory (`memory/buyers.md`, `memory/sellers/`, `memory/designs/sarah_*`, and the various `sarah_*` / `index_lead*` / `verify_sarah_*` Python scripts at repo root) are kept for historical reference but are **not** part of the current CarSpa mission.
