# main.py - Unified Academic Management Server (API Routes Only)
from fastapi import FastAPI, Depends, Query
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from pathlib import Path
from typing import List, Dict, Any
import uvicorn
import os
import sqlite3

# Import helper modules and their functions
from src.api.accesscontrolserver import (
    CredentialCreate, CredentialUpdate,
    debug_dbinfo_func, debug_tables_func, debug_schema_func,
    list_credentials_func, create_credential_func, update_credential_func, delete_credential_func
)

from src.api.profleaveserver import (
    get_db as leaves_get_db,
    LeaveCreate, LeaveUpdate, 
    fetch_leaves_func, add_leave_func, edit_leave_func, delete_leave_func, get_session_info_func
)

from src.api.reschedulerserver import (
    get_app_config_func, get_schedules_func, get_valid_slots_func,
    get_leaves_func, add_leave_rescheduler_func, update_leave_rescheduler_func,
    delete_leave_rescheduler_func, save_changes_rescheduler_func, get_all_professors_func, update_course_professors_func, add_new_class_func, fetch_leaves_rescheduler_func,
    ProfessorLeave, ChangeLog, CourseProfessorUpdate, NewClassRequest, LeaveUpdate as ReschedulerLeaveUpdate
)

# Configuration
API_PORT = 8000

app = FastAPI(
    title="Unified Academic Management Server",
    description="Combined server for access control, professor leaves, schedule viewing, and rescheduling",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],  # Your frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Only mount static files and templates if directories exist
if os.path.exists("static"):
    from fastapi.staticfiles import StaticFiles
    app.mount("/static", StaticFiles(directory="static"), name="static")

if os.path.exists("templates"):
    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory="templates")
    
    @app.get("/", response_class=HTMLResponse)
    async def home():
        return RedirectResponse(url="/dashboard")
    
    @app.get("/dashboard", response_class=HTMLResponse)
    async def dashboard():
        return templates.TemplateResponse("dashboard.html", {
            "request": {},
            "professor_name": "Professor",
            "user_type": "Faculty",
            "email": "user@example.com"
        })
    
    @app.get("/not-registered", response_class=HTMLResponse)
    async def not_registered():
        return templates.TemplateResponse("not_registered.html", {
            "request": {},
            "email": "user@example.com"
        })
else:
    # Provide basic API response if templates don't exist
    @app.get("/")
    async def root():
        return JSONResponse({
            "message": "Unified Academic Management Server",
            "status": "running",
            "endpoints": {
                "authentication": "/api/login",
                "access_control": "/api/credentials",
                "leaves_management": "/api/leavess/fetch",
                "schedule_management": "/api/get-schedule",
                "rescheduler": "/api/get-app-config"
            },
            "documentation": "/docs",
            "health_check": "/health"
        })


# ===== Access Control Routes =====
@app.get('/debug/dbinfo')
async def debug_dbinfo():
    return debug_dbinfo_func()

@app.get('/debug/tables')
async def debug_tables():
    return debug_tables_func()

@app.get('/debug/schema')
async def debug_schema():
    return debug_schema_func()

@app.get('/api/credentials')
async def list_credentials():
    return list_credentials_func()

@app.post('/api/credentials')
async def create_credential(credential: CredentialCreate):
    return create_credential_func(credential)

@app.put('/api/credentials/{email}')
async def update_credential(email: str, credential: CredentialUpdate):
    return update_credential_func(email, credential)

@app.delete('/api/credentials/{email}')
async def delete_credential(email: str):
    return delete_credential_func(email)

# ===== Leave Management Routes =====
@app.get("/api/leavess/fetch")
async def api_fetch_leaves(request: Request, db=Depends(leaves_get_db)):
    professor_name = request.query_params.get("professor", "Professor")
    return fetch_leaves_func(db, professor_name)

@app.post("/api/leavess/add")
async def api_add_leave(request: Request, leave: LeaveCreate, db=Depends(leaves_get_db)):
    professor_name = request.query_params.get("professor", "Professor")
    return add_leave_func(db, leave, professor_name)

@app.post("/api/leavess/edit/{leave_id}")
async def api_edit_leave(request: Request, leave_id: int, leave: LeaveUpdate, db=Depends(leaves_get_db)):
    professor_name = request.query_params.get("professor", "Professor")
    return edit_leave_func(db, leave_id, leave, professor_name)

@app.post("/api/leavess/delete/{leave_id}")
async def api_delete_leave(request: Request, leave_id: int, db=Depends(leaves_get_db)):
    professor_name = request.query_params.get("professor", "Professor")
    return delete_leave_func(db, leave_id, professor_name)

@app.get("/api/session/info")
async def api_session_info():
    return get_session_info_func()

# ===== Rescheduler Routes =====
@app.get("/api/get-app-config")
async def get_app_config():
    return get_app_config_func()

@app.get("/api/get-schedules")
async def get_schedules(
    batch: str = Query(..., description="Batch code, e.g., MBA10"),
    term: str = Query(..., description="Term, e.g., TERM IV"),
    section: str = Query(..., description="Section, e.g., A")
):
    return get_schedules_func(batch, term, section)

@app.get("/api/get-valid-slots")
async def get_valid_slots(commitment_id: str = Query(..., description="ID of the commitment being dragged")):
    return get_valid_slots_func(commitment_id)

@app.get("/api/leaves/{professor_name}")
def get_leaves(professor_name: str):
    return get_leaves_func(professor_name)

@app.post("/api/leaves")
def add_leave(leave: ProfessorLeave):
    return add_leave_rescheduler_func(leave)

@app.put("/api/leaves/{leave_id}")
def update_leave(leave_id: int, leave_data: ReschedulerLeaveUpdate):
    return update_leave_rescheduler_func(leave_id, leave_data)

@app.delete("/api/leaves/{leave_id}")
def delete_leave(leave_id: int):
    return delete_leave_rescheduler_func(leave_id)

@app.post("/api/save-changess")
async def save_changes_rescheduler(changes: list[ChangeLog]):
    return save_changes_rescheduler_func(changes)

@app.get("/api/fetch/leaves")
def fetch_leaves():
    return fetch_leaves_rescheduler_func()

# ===== New Rescheduler Routes =====
@app.get("/api/get-all-professors")
async def get_all_professors():
    return get_all_professors_func()

@app.post("/api/update-course-professors")
async def update_course_professors(updates: List[CourseProfessorUpdate]):
    return update_course_professors_func(updates)

@app.post("/api/add-new-class")
async def add_new_class(new_class: NewClassRequest):
    return add_new_class_func(new_class)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Unified Academic Management Server"}

# API documentation info
@app.get("/api")
async def api_info():
    return {
        "message": "Unified Academic Management API",
        "version": "1.0.0",
        "modules": [
            "Access Control",
            "Professor Leaves Management", 
            "Schedule Viewer",
            "Rescheduler"
        ],
        "documentation": "/docs"
    }

if __name__ == "__main__":
    print(f"🚀 Starting UNIFIED FastAPI server on http://127.0.0.1:{API_PORT}")
    print(f"📚 Available modules: Access Control, Professor Leaves, Schedule Viewer, Rescheduler")
    print(f"📖 API Documentation: http://127.0.0.1:{API_PORT}/docs")
    print(f"❤️  Health Check: http://127.0.0.1:{API_PORT}/health")
    print(f"🔍 API Info: http://127.0.0.1:{API_PORT}/api")
    uvicorn.run(
        app, 
        host="127.0.0.1", 
        port=API_PORT,
        log_level="info"
    )