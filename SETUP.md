# Setup Guide

Follow these steps to run the project locally.

---

## 1. Clone the repo

```bash
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>
```

---

## 2. Create virtual environment

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
```

---

## 3. Install dependencies

```bash
pip install -r requirements.txt
```

---

## 4. Seed the sample database

This copies `sample_schedules.db` into `src/db/in-use_schedules.db`.

```bash
python scripts/seed_sample_db.py
```

---

## 5. Run the backend

```bash
uvicorn src.api.main:app --reload
```

Backend runs at:

```
http://127.0.0.1:8000
```

---

## 6. Open the frontend

Open the following HTML files directly in your browser:

- `src/frontend/rescheduler.html`
- `src/frontend/access.html`
- `src/frontend/profleaves.html`

---

## Notes

- All data is from a **sanitized sample database**.
