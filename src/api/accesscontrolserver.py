# accesscontrol.py - Helper module
from fastapi import HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pathlib import Path
import sqlite3
import os
import traceback
from typing import List, Optional, Dict, Any

PROJECT_SRC = Path(__file__).resolve().parents[1]   # src/
DEFAULT_DB = PROJECT_SRC / "db" / "in-use_schedules.db"
DB_PATH = Path(os.getenv("DATABASE_PATH", DEFAULT_DB)).resolve()
#DB_PATH = os.path.join(os.path.dirname(__file__), 'in-use_schedules.db')
VALID_ACCESS = {'VWR', 'SCR', 'RSCR', 'ACL', 'DBCL', 'SCS', 'PLS'}

# Pydantic models
class CredentialBase(BaseModel):
    email: str
    user_type: str
    professor_name: Optional[str] = None

class CredentialCreate(BaseModel):
    email: str
    user_type: str
    professor_name: Optional[str] = None

class CredentialUpdate(BaseModel):
    user_type: str
    professor_name: Optional[str] = None

class DebugResponse(BaseModel):
    db_path: str
    exists: bool
    size_bytes: Optional[int] = None

class TablesResponse(BaseModel):
    tables: List[str]

class DiscoveryResponse(BaseModel):
    table: Optional[str]
    cols: List[str]
    col_map: Dict[str, Any]

# Database dependency
def get_db():
    db = None
    try:
        db = sqlite3.connect(DB_PATH, check_same_thread=False)
        db.row_factory = sqlite3.Row
        yield db
    finally:
        if db:
            db.close()

# discovery cache
DISCOVERY = {'table': None, 'cols': None, 'col_map': None}

def discover_schema():
    if DISCOVERY['table'] is not None:
        return DISCOVERY
    
    try:
        with sqlite3.connect(DB_PATH, check_same_thread=False) as db:
            db.row_factory = sqlite3.Row
            cur = db.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [r['name'] for r in cur.fetchall()]
            table_match = None
            for t in tables:
                if t.lower() == 'credentials':
                    table_match = t
                    break
            if table_match is None:
                DISCOVERY['table'] = None
                DISCOVERY['cols'] = []
                DISCOVERY['col_map'] = {}
                return DISCOVERY
            
            cur = db.execute(f"PRAGMA table_info('{table_match}');")
            cols = [r['name'] for r in cur.fetchall()]
            mapping = {'email': None, 'user_type': None, 'professor_name': None}
            lowered = {c.lower(): c for c in cols}
            # Map to new column names: email -> mail, professor_name -> username, user_type -> access
            for candidate in ('mail','email','e-mail','user_email','username'):
                if candidate in lowered and mapping['email'] is None:
                    mapping['email'] = lowered[candidate]
            for candidate in ('access','user_type','type','role','userrole','user_role'):
                if candidate in lowered and mapping['user_type'] is None:
                    mapping['user_type'] = lowered[candidate]
            for candidate in ('username','professor_name','prof_name','name','professor','professorname'):
                if candidate in lowered and mapping['professor_name'] is None:
                    mapping['professor_name'] = lowered[candidate]
            for key in list(mapping.keys()):
                if mapping[key] is None and key in lowered:
                    mapping[key] = lowered[key]
            DISCOVERY['table'] = table_match
            DISCOVERY['cols'] = cols
            DISCOVERY['col_map'] = mapping
            return DISCOVERY
    except Exception as e:
        DISCOVERY['table'] = None
        DISCOVERY['cols'] = []
        DISCOVERY['col_map'] = {}
        return DISCOVERY

def build_select_query():
    disc = discover_schema()
    if disc['table'] is None:
        raise RuntimeError("No table named 'credentials' (case-insensitive) found in DB.")
    t = disc['table']
    m = disc['col_map']
    if not m['email'] or not m['user_type']:
        raise RuntimeError(f"Table '{t}' exists but required columns not found. Columns present: {disc['cols']}")
    prof_col = m['professor_name']
    select_parts = [f"{m['email']} AS email", f"{m['user_type']} AS user_type"]
    if prof_col:
        select_parts.append(f"{prof_col} AS professor_name")
    else:
        select_parts.append(f"NULL AS professor_name")
    sql = f"SELECT {', '.join(select_parts)} FROM \"{t}\""
    return sql

def map_payload_to_columns(payload: dict):
    disc = discover_schema()
    t = disc['table']
    if t is None:
        raise RuntimeError("No credentials table discovered.")
    m = disc['col_map']
    data = {}
    if 'email' in payload and m['email']:
        data[m['email']] = payload['email']
    if 'user_type' in payload and m['user_type']:
        data[m['user_type']] = payload['user_type']
    if 'professor_name' in payload and m['professor_name']:
        data[m['professor_name']] = payload['professor_name']
    return t, data

# Validate access string
def validate_access(access_str: str) -> bool:
    """Validate that access string contains valid access codes"""
    if not access_str or not access_str.strip():
        return False
    access_codes = [code.strip() for code in access_str.split(',')]
    return all(code in VALID_ACCESS for code in access_codes)

# Access control functions
def debug_dbinfo_func():
    exists = os.path.exists(DB_PATH)
    size = None
    try:
        size = os.path.getsize(DB_PATH) if exists else None
    except:
        size = None
    return DebugResponse(
        db_path=os.path.abspath(DB_PATH),
        exists=exists,
        size_bytes=size
    )

def debug_tables_func():
    try:
        with sqlite3.connect(DB_PATH, check_same_thread=False) as db:
            db.row_factory = sqlite3.Row
            cur = db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
            tables = [r['name'] for r in cur.fetchall()]
            return TablesResponse(tables=tables)
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={'error': str(e), 'trace': traceback.format_exc()}
        )

def debug_schema_func():
    disc = discover_schema()
    return DiscoveryResponse(**disc)

def list_credentials_func():
    try:
        sql = build_select_query()
        with sqlite3.connect(DB_PATH, check_same_thread=False) as db:
            db.row_factory = sqlite3.Row
            cur = db.execute(sql + " ORDER BY email COLLATE NOCASE;")
            rows = cur.fetchall()
            result = []
            for r in rows:
                result.append({
                    'email': r['email'], 
                    'user_type': r['user_type'], 
                    'professor_name': r['professor_name']
                })
            return result
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={'error': 'Failed to list credentials', 'detail': str(e), 'trace': traceback.format_exc()}
        )

def create_credential_func(credential: CredentialCreate):
    try:
        body = credential.dict()
        if not body or 'email' not in body or 'user_type' not in body:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='email and user_type are required.'
            )
        
        # Validate access - must contain at least VWR and valid codes
        if not validate_access(body['user_type']):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid access. Must contain valid access codes from: {', '.join(sorted(VALID_ACCESS))}. VWR is required by default."
            )
            
        t, data = map_payload_to_columns(body)
        with sqlite3.connect(DB_PATH, check_same_thread=False) as db:
            cols = ','.join(f'"{k}"' for k in data.keys())
            placeholders = ','.join('?' for _ in data)
            vals = list(data.values())
            try:
                cur = db.execute(f'INSERT INTO "{t}" ({cols}) VALUES ({placeholders})', vals)
                db.commit()
                return {'ok': True}
            except sqlite3.IntegrityError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail='Email already exists.'
                )
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={'error': 'Create failed', 'detail': str(e), 'trace': traceback.format_exc()}
        )

def update_credential_func(email: str, credential: CredentialUpdate):
    try:
        body = credential.dict()
        if not body or 'user_type' not in body:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='user_type is required for update.'
            )
        
        # Validate access
        if not validate_access(body['user_type']):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid access. Must contain valid access codes from: {', '.join(sorted(VALID_ACCESS))}"
            )
            
        t, _ = map_payload_to_columns(body)
        disc = discover_schema()
        m = disc['col_map']
        set_parts = []
        vals = []
        
        set_parts.append(f"\"{m['user_type']}\" = ?")
        vals.append(body['user_type'])
        
        if 'professor_name' in body and m['professor_name']:
            set_parts.append(f"\"{m['professor_name']}\" = ?")
            vals.append(body.get('professor_name'))
            
        vals.append(email)
        sql = f'UPDATE "{t}" SET {", ".join(set_parts)} WHERE "{m["email"]}" = ?'
        
        with sqlite3.connect(DB_PATH, check_same_thread=False) as db:
            cur = db.execute(sql, vals)
            db.commit()
            if cur.rowcount == 0:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail='Not found.'
                )
            return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={'error': 'Update failed', 'detail': str(e), 'trace': traceback.format_exc()}
        )

def delete_credential_func(email: str):
    try:
        disc = discover_schema()
        t = disc['table']
        if t is None:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={'error': "credentials table not found."}
            )
        m = disc['col_map']
        with sqlite3.connect(DB_PATH, check_same_thread=False) as db:
            cur = db.execute(f'DELETE FROM "{t}" WHERE "{m["email"]}" = ?', (email,))
            db.commit()
            if cur.rowcount == 0:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail='Not found.'
                )
            return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={'error': 'Delete failed', 'detail': str(e), 'trace': traceback.format_exc()}
        )