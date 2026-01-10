# Faculty Rescheduler & Leave Management System – IIM Bodh Gaya

A lightweight internal tool used for managing **faculty schedules, rescheduling requests, access control, and leave workflows**.  
Built with a Python backend (FastAPI) and a fully custom, vibe-coded frontend (HTML/JS/CSS).

Designed for academic departments that need a fast, intuitive way to manage complex scheduling operations.

---

## 🚀 Features

### ✔ Rescheduler
- Drag-and-drop rescheduling
- Add new classes
- Edit professor–course mapping
- Real-time slot validation
- Undo/reset logic
- Batch/term/section filtering
- Dynamic schedule rendering

### ✔ Professor Leaves
- Add/edit/delete leaves
- Modal-based UI
- Integrated with commitments
- Conflict-aware workflows

### ✔ Access Control
- Manage user roles (ACL, RSCR, VWR)
- Add/edit/delete credentials
- Simple UI for admin workflows

---

## 🛠 Tech Stack

**Frontend:**  
- HTML  
- CSS  
- Vanilla JavaScript (`type="module"`)

**Backend:**  
- Python 3.10+  
- FastAPI  
- Uvicorn  
- SQLite using a **sanitized sample DB**

---

## 📂 Project Structure

```
project-root/
    src/
        api/
            __init__.py
            main.py
            accesscontrolserver.py
            profleaveserver.py
            reschedulerserver.py
        frontend/
            *.html
            js/
            css/
        db/
            sample_schedules.db
    scripts/
        seed_sample_db.py
    docs/
        demo.mp4
        architecture.png
    README.md
    CONTRIBUTION.md
    SETUP.md
    API_GUIDE.md
    LICENSE
    .gitignore
    .env.example
```

---

## ▶ Demo Video

A short 90–120 second demo is available in:

```
/docs/demo.mp4
```

---

## 🧩 Architecture

- Frontend loads static HTML/CSS/JS
- JS interacts with FastAPI backend via REST
- Backend writes to SQLite DB
- Three core backend modules:
  - `rescheduler`
  - `access control`
  - `professor leaves`

Architecture diagram in:

```
/docs/architecture.png
```

---

## 📝 Quick Start

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

python scripts/seed_sample_db.py

uvicorn src.api.main:app --reload
```

Open frontend:

```
src/frontend/rescheduler.html
src/frontend/access.html
src/frontend/profleaves.html
```

---

## 👤 Author & Contribution

This project was built by a team of three, but I independently built:

- Entire **Rescheduler UI & JS logic**
- Entire **Professor Leaves frontend**
- Entire **Access Control frontend**
- Integrated backend endpoints for these modules
- Debugged and wired the full flow together

Full details in: `CONTRIBUTION.md`.

---

## 📄 License

MIT License. See `LICENSE`.
