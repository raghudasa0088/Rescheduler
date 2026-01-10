# profleaveserver.py - Helper module
import os
import sqlite3
from fastapi import HTTPException, Depends, status
from fastapi.responses import JSONResponse
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List

PROJECT_SRC = Path(__file__).resolve().parents[1]   # src/
DEFAULT_DB = PROJECT_SRC / "db" / "in-use_schedules.db"
DB_PATH = Path(os.getenv("DATABASE_PATH", DEFAULT_DB)).resolve()

# Pydantic models
class LeaveBase(BaseModel):
    start_date: str
    end_date: str

class LeaveCreate(LeaveBase):
    pass

class LeaveUpdate(LeaveBase):
    pass

class LeaveResponse(LeaveBase):
    leave_id: int
    professor_name: str

class SessionInfo(BaseModel):
    ok: bool
    authenticated: bool
    email: Optional[str] = None
    professor_name: Optional[str] = None
    user_type: Optional[str] = None

# Database connection helper
def get_db():
    db = None
    try:
        db = sqlite3.connect(DB_PATH, check_same_thread=False)
        db.row_factory = sqlite3.Row
        yield db
    finally:
        if db:
            db.close()

# Query helper functions
def query_db(db: sqlite3.Connection, query: str, args: tuple = (), one: bool = False):
    cur = db.execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

def execute_db(db: sqlite3.Connection, query: str, args: tuple = ()):
    cur = db.execute(query, args)
    db.commit()
    lastrowid = cur.lastrowid
    cur.close()
    return lastrowid

# Leave management functions
def fetch_leaves_func(db: sqlite3.Connection, professor_name: str):
    try:        
        # First, let's check what professors exist in the database
        all_professors = query_db(db, "SELECT DISTINCT professor_name FROM ProfessorLeaves")        
        rows = query_db(
            db,
            "SELECT leave_id, professor_name, start_date, end_date FROM ProfessorLeaves WHERE professor_name = ? ORDER BY leave_id",
            (professor_name,),
        )
        
        leaves = [dict(r) for r in rows]
        return {"ok": True, "leaves": leaves}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching leaves: {str(e)}"
        )

def add_leave_func(db: sqlite3.Connection, leave: LeaveCreate, professor_name: str = "Professor"):
    try:
        if not leave.start_date or not leave.end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing start or end date"
            )

        last_id = execute_db(
            db,
            "INSERT INTO ProfessorLeaves (professor_name, start_date, end_date) VALUES (?, ?, ?)",
            (professor_name, leave.start_date, leave.end_date),
        )

        return {"ok": True, "leave_id": last_id}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Server error during add operation: {str(e)}"
        )

def edit_leave_func(db: sqlite3.Connection, leave_id: int, leave: LeaveUpdate, professor_name: str = "Professor"):
    try:
        if not leave.start_date or not leave.end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing start or end date"
            )

        cur = db.execute(
            "UPDATE ProfessorLeaves SET start_date = ?, end_date = ? WHERE leave_id = ? AND professor_name = ?",
            (leave.start_date, leave.end_date, leave_id, professor_name),
        )
        db.commit()

        if cur.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Leave not found or not authorized to edit"
            )

        return {"ok": True, "updated_rows": cur.rowcount}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Server error during edit operation: {str(e)}"
        )

def delete_leave_func(db: sqlite3.Connection, leave_id: int, professor_name: str = "Professor"):
    try:
        cur = db.execute(
            "DELETE FROM ProfessorLeaves WHERE leave_id = ? AND professor_name = ?",
            (leave_id, professor_name),
        )
        db.commit()

        if cur.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Leave not found or not authorized to delete"
            )

        return {"ok": True, "deleted_rows": cur.rowcount}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Server error during delete operation: {str(e)}"
        )

def get_session_info_func():
    return {
        "ok": True,
        "authenticated": True,
        "email": "user@example.com",
        "professor_name": "Professor", 
        "user_type": "Faculty"
    }