# reschedulerserver.py - Helper module
import sqlite3
from fastapi import HTTPException, Query
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from pathlib import Path
import os
from datetime import datetime, timedelta

PROJECT_SRC = Path(__file__).resolve().parents[1]   # src/
DEFAULT_DB = PROJECT_SRC / "db" / "in-use_schedules.db"
DB_PATH = Path(os.getenv("DATABASE_PATH", DEFAULT_DB)).resolve()
TABLE_NAME = "Commitments"
LEAVE_TABLE_NAME = "ProfessorLeaves"

# Pydantic models
class LoginRequest(BaseModel):
    email: str
    session_id: Optional[str] = None

class LoginResponse(BaseModel):
    success: bool
    user_type: str
    professor_name: Optional[str] = None
    detail: Optional[str] = None

class ProfessorLeave(BaseModel):
    professor_name: str
    start_date: str
    end_date: str

class LeaveUpdate(BaseModel):
    start_date: str
    end_date: str

class CredentialManageRequest(BaseModel):
    email: str
    user_type: str
    professor_name: Optional[str] = None

class ChangeLog(BaseModel):
    source_commitment_id: str
    target_slot_timestamp: str
    source_original_timestamp: str
    target_commitment_id: Optional[str] = None

class CourseProfessorUpdate(BaseModel):
    batch: str
    academic_term: str
    section: str
    course_name: str
    new_professor: str
    effective_date: str

class CourseProfessorChange(BaseModel):
    batch: str
    academic_term: str
    section: str
    course_name: str
    new_professor: str
    effective_date: str  # or use date type if you prefer    

class NewClassRequest(BaseModel):
    course_name: str
    professor_name: str
    start_time: str
    end_time: str
    academic_term: str  # This must match your table column name
    section: str
    batch: str

# Database Helper Functions
def db_connect():
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        print(f"Error connecting to database: {e}")
        return None

def parse_iso_timestamp(ts_str: str) -> Dict[str, str]:
    try:
        dt = datetime.fromisoformat(ts_str)
        return {
            "date": dt.strftime("%Y-%m-%d"),
            "day": dt.strftime("%A"),
            "start_time": dt.strftime("%H:%M"),
        }
    except (ValueError, TypeError):
        return {
            "date": "Invalid Date",
            "day": "Invalid Day",
            "start_time": "Invalid Time",
        }

def fetch_schedule_data(conn, query: str, params: tuple) -> List[Dict[str, Any]]:
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    schedule_list = []
    for row in rows:
        parsed_time = parse_iso_timestamp(row["start_time_ts"])
        
        schedule_list.append({
            "commitment_id": row["commitment_id"],
            "professor_name": row["professor_name"],
            "start_time_ts": row["start_time_ts"],
            "end_time": row["end_time"],
            "batch": row["batch"],
            "academic_term": row["academic_term"],
            "section": row["section"],
            "course_name": row["course_name"],
            **parsed_time,
        })
    return schedule_list

def get_all_professors_func():
    """Get all unique professors from commitments table"""
    conn = db_connect()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection error")
    
    try:
        cursor = conn.cursor()
        cursor.execute(f"SELECT DISTINCT professor_name FROM {TABLE_NAME} ORDER BY professor_name")
        professors = [row[0] for row in cursor.fetchall()]
        return {"success": True, "professors": professors}
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if conn:
            conn.close()

# Rescheduler functions
def get_app_config_func():
    conn = db_connect()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection error")
    
    try:
        cursor = conn.cursor()
        
        # Get Filter Options
        filter_query = f"""
            SELECT DISTINCT batch, academic_term, section 
            FROM {TABLE_NAME}
            ORDER BY batch, academic_term, section
        """
        cursor.execute(filter_query)
        filter_rows = cursor.fetchall()
        
        options = {}
        for row in filter_rows:
            batch = row["batch"]
            term = row["academic_term"]
            section = row["section"]
            
            if batch not in options:
                options[batch] = {}
            if term not in options[batch]:
                options[batch][term] = []
            if section not in options[batch][term]:
                options[batch][term].append(section)
        
        # Get Leave Data
        leaves = []
        leave_query = f"""
            SELECT professor_name, start_date, end_date
            FROM {LEAVE_TABLE_NAME}
        """
        try:
            cursor.execute(leave_query)
            leave_rows = cursor.fetchall()
            leaves = [dict(row) for row in leave_rows]
        except sqlite3.Error as e:
            if "no such table" in str(e):
                print(f"Warning: Table '{LEAVE_TABLE_NAME}' does not exist. Returning empty leave list.")
            else:
                raise
                
        return {"filters": options, "leaves": leaves}

    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=f"Database query error: {e}")
    finally:
        if conn:
            conn.close()

def get_schedules_func(batch: str, term: str, section: str):
    conn = db_connect()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection error")
    
    try:
        # Query 1: Get the specific schedule for the section
        section_query = f"""
            SELECT 
                commitment_id, professor_name, start_time AS start_time_ts, end_time, 
                batch, academic_term, section, course_name
            FROM {TABLE_NAME}
            WHERE batch = ? AND academic_term = ? AND section = ?
            ORDER BY start_time
        """
        section_schedule = fetch_schedule_data(conn, section_query, (batch, term, section))
        
        if not section_schedule:
            return {
                "section_schedule": [],
                "full_schedule": []
            }

        # Find the date range of the section schedule
        valid_dates = [lec["date"] for lec in section_schedule if lec["date"] != "Invalid Date"]
        if not valid_dates:
             return {"section_schedule": section_schedule, "full_schedule": []}
             
        min_date = min(valid_dates)
        max_date = max(valid_dates)

        # Query 2: Get the FULL schedule for ALL batches/profs in this date range
        full_query = f"""
            SELECT 
                commitment_id, professor_name, start_time AS start_time_ts, end_time, 
                batch, academic_term, section, course_name
            FROM {TABLE_NAME}
            WHERE DATE(start_time) BETWEEN ? AND ?
            ORDER BY start_time
        """
        full_schedule = fetch_schedule_data(conn, full_query, (min_date, max_date))
        
        return {
            "section_schedule": section_schedule,
            "full_schedule": full_schedule
        }

    except sqlite3.Error as e:
        print(f"Database logic error: {e}")
        raise HTTPException(status_code=500, detail=f"Database logic error: {e}")
    except ValueError as e:
        print(f"Date logic error: {e}")
        raise HTTPException(status_code=500, detail=f"Date logic error: {e}")
    finally:
        if conn:
            conn.close()

def get_valid_slots_func(commitment_id: str):
    return {"message": "This endpoint is deprecated. All validation logic is now client-side."}

def get_leaves_func(professor_name: str):
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id as leave_id, professor_name, start_date, end_date FROM ProfessorLeaves WHERE professor_name = ?", 
            (professor_name,)
        )
        rows = cursor.fetchall()
        return {"success": True, "data": [dict(row) for row in rows]}
    except sqlite3.Error as e:
        print(f"Fetch Leaves Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: conn.close()


def add_new_class_func(new_class: NewClassRequest):
    conn = db_connect()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection error")
    
    try:
        cursor = conn.cursor()
        
        # INSERT without commitment_id - let DB auto-generate it
        insert_query = f"""
            INSERT INTO {TABLE_NAME} 
            (professor_name, start_time, end_time, batch, academic_term, section, course_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        
        cursor.execute(insert_query, (
            new_class.professor_name,
            new_class.start_time, 
            new_class.end_time,
            new_class.batch,
            new_class.academic_term,
            new_class.section,
            new_class.course_name
        ))
        
        conn.commit()
        return {"success": True, "message": "Class added successfully"}
        
    except sqlite3.Error as e:
        conn.rollback()
        print(f"Database error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if conn:
            conn.close()


def add_leave_rescheduler_func(leave: ProfessorLeave):
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO ProfessorLeaves (professor_name, start_date, end_date) VALUES (?, ?, ?)",
            (leave.professor_name, leave.start_date, leave.end_date)
        )
        conn.commit()
        return {"success": True, "message": "Leave added successfully"}
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: conn.close()

def update_course_professors_func(changes: List[CourseProfessorChange]):
    """Update course professors with effective date"""
    conn = db_connect()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection error")
    
    try:
        cursor = conn.cursor()
        updated_count = 0
        
        for change in changes:
            # Update all future classes for this course with the new professor
            update_query = f"""
                UPDATE {TABLE_NAME} 
                SET professor_name = ?
                WHERE batch = ? 
                AND academic_term = ?
                AND section = ?
                AND course_name = ?
                AND start_time >= ?
            """
            
            cursor.execute(update_query, (
                change.new_professor,
                change.batch,
                change.academic_term,
                change.section,
                change.course_name,
                change.effective_date
            ))
            
            if cursor.rowcount > 0:
                updated_count += 1
        
        conn.commit()
        return {"success": True, "updated": updated_count}
        
    except sqlite3.Error as e:
        conn.rollback()
        print(f"Database error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if conn:
            conn.close()


def update_leave_rescheduler_func(leave_id: int, leave_data: LeaveUpdate):
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE ProfessorLeaves SET start_date = ?, end_date = ? WHERE id = ?",
            (leave_data.start_date, leave_data.end_date, leave_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Leave not found")
        conn.commit()
        return {"success": True, "message": "Leave updated successfully"}
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: conn.close()

def delete_leave_rescheduler_func(leave_id: int):
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM ProfessorLeaves WHERE id = ?", (leave_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Leave not found")
        conn.commit()
        return {"success": True, "message": "Leave deleted successfully"}
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: conn.close()

def save_changes_rescheduler_func(changes: List[ChangeLog]):
    conn = db_connect()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection error")
    
    cursor = conn.cursor()
    changes_committed = 0
    
    try:
        for change in changes:
            cursor.execute(f"SELECT * FROM {TABLE_NAME} WHERE commitment_id = ?", (change.source_commitment_id,))
            source_lecture = cursor.fetchone()
            if not source_lecture:
                print(f"Skipping change: Source lecture {change.source_commitment_id} not found.")
                continue
            
            source_start_dt = datetime.fromisoformat(source_lecture["start_time"])
            source_end_dt = datetime.fromisoformat(source_lecture["end_time"])
            source_duration = source_end_dt - source_start_dt
            
            target_start_dt = datetime.fromisoformat(change.target_slot_timestamp)
            target_new_end_ts = (target_start_dt + source_duration).isoformat()

            if change.target_commitment_id:
                cursor.execute(f"SELECT * FROM {TABLE_NAME} WHERE commitment_id = ?", (change.target_commitment_id,))
                target_lecture = cursor.fetchone()
                if not target_lecture:
                        print(f"Skipping change: Target lecture {change.target_commitment_id} not found.")
                        continue

                target_start_dt_orig = datetime.fromisoformat(target_lecture["start_time"])
                target_end_dt_orig = datetime.fromisoformat(target_lecture["end_time"])
                target_duration = target_end_dt_orig - target_start_dt_orig
                
                source_start_dt_orig = datetime.fromisoformat(change.source_original_timestamp)
                source_new_end_ts = (source_start_dt_orig + target_duration).isoformat()

                cursor.execute(
                    f"UPDATE {TABLE_NAME} SET start_time = ?, end_time = ? WHERE commitment_id = ?",
                    (change.target_slot_timestamp, target_new_end_ts, change.source_commitment_id)
                )
                cursor.execute(
                    f"UPDATE {TABLE_NAME} SET start_time = ?, end_time = ? WHERE commitment_id = ?",
                    (change.source_original_timestamp, source_new_end_ts, change.target_commitment_id)
                )
                
            else:
                cursor.execute(
                    f"UPDATE {TABLE_NAME} SET start_time = ?, end_time = ? WHERE commitment_id = ?",
                    (change.target_slot_timestamp, target_new_end_ts, change.source_commitment_id)
                )
            
            changes_committed += 1
        
        conn.commit()
        
        return {"success": True, "changes_committed": changes_committed}

    except (sqlite3.Error, ValueError, TypeError) as e:
        conn.rollback()
        print(f"Error saving changes, transaction rolled back: {e}")
        raise HTTPException(status_code=500, detail=f"Database logic error, transaction rolled back: {e}")
    finally:
        if conn:
            conn.close()

def fetch_leaves_rescheduler_func():
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT leave_id, professor_name, start_date, end_date FROM ProfessorLeaves")
        rows = cursor.fetchall()
        leaves = [dict(r) for r in rows]
        return {"success": True, "data": leaves}
    except Exception as e:
        print("fetch_leaves error:", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()
