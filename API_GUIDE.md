# API Guide (FastAPI)

This document lists the core API endpoints used by the rescheduler, access control, and professor leave modules.

All endpoints assume the base URL:

```
http://127.0.0.1:8000
```

---

# 1. Rescheduler

## GET /api/rescheduler/commitments  
Fetch commitments (schedule items).

**Response**
```json
[
  {
    "commitment_id": "CMT-1001",
    "professor_name": "Dr. A. Sharma",
    "start_time": "2025-12-18T09:00:00",
    "end_time": "2025-12-18T10:00:00",
    "batch": "MBA10",
    "academic_term": "TERM IV",
    "section": "A",
    "course_name": "Microeconomics"
  }
]
```

---

## POST /api/rescheduler/update  
Update a commitment after a drag/drop or edit.

**Body**
```json
{
  "commitment_id": "CMT-1001",
  "start_time": "...",
  "end_time": "...",
  "professor_name": "..."
}
```

---

# 2. Professor Leaves

## GET /api/leaves  
List all leaves.

## POST /api/leaves/add  
Add a leave.

**Body**
```json
{
  "professor_name": "Dr. C. Singh",
  "start_date": "2025-12-19",
  "end_date": "2025-12-19"
}
```

## POST /api/leaves/edit  
Edit an existing leave.

## POST /api/leaves/delete  
Delete a leave.

---

# 3. Access Control

## GET /api/access/credentials  
Fetch credential list.

## POST /api/access/create  
Add a credential.

## POST /api/access/update  
Update a credential.

## POST /api/access/delete  
Delete a credential.

---

# Notes

- Endpoints use JSON throughout.
- This guide uses simplified examples for clarity.
