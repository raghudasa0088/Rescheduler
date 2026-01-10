document.addEventListener('DOMContentLoaded', () => {
            // --- Global State ---
            const API_BASE = window.API_BASE || "http://127.0.0.1:8000";
            
            let scheduleDataStore = [];
            let sectionScheduleData = [];
            let professorLeaveStore = [];
            let draggedItem = null;
            let sourceCell = null;
            let sourceCommitmentId = null;
            let sourceProfessor = null;
            let tableTimeSlots = [];
            
            let filterOptions = {};
            let currentSelection = { batch: '', term: '', section: '' };
            
            let pendingChanges = [];
            let undoStack = [];
            let pristineScheduleSnapshot = null;
            
            let scrollSpeed = 0;
            let tableContainerRect = null;

            // --- Element References ---
            const table = document.getElementById('schedule-table');
            const tableBody = table.querySelector('tbody');
            const tableHead = table.querySelector('thead');
            const tableContainer = document.getElementById('table-container');
            
            const batchSelect = document.getElementById('batch-select');
            const termSelect = document.getElementById('term-select');
            const sectionSelect = document.getElementById('section-select');
            const professorFilter = document.getElementById('professor-filter');
            const courseFilter = document.getElementById('course-filter');
            
            const saveBtn = document.getElementById('save-changes-btn');
            const resetBtn = document.getElementById('reset-btn');
            const undoBtn = document.getElementById('undo-btn');
            const addClassBtn = document.getElementById('add-class-btn');
            const editCourseBtn = document.getElementById('edit-course-btn');
            const showAllBtn = document.getElementById('show-all-btn');
            
            const messageBox = document.getElementById('message-box');
            const dragClone = document.getElementById('drag-clone');
            
            // Modal elements
            const addClassModal = document.getElementById('add-class-modal');
            const editCourseModal = document.getElementById('edit-course-modal');
            const addClassForm = document.getElementById('add-class-form');
            const courseList = document.getElementById('course-list');
            const courseDetails = document.getElementById('course-details');
            const updateCourseBtn = document.getElementById('update-course-btn');
            const effectiveDateInput = document.getElementById('effective-date');
            const currentProfessorSpan = document.getElementById('current-professor');
            
            const pristineSnapshots = {};
            const pristineSectionSnapshots = {};

            // --- Core Functions ---

            function showMessage(message, type = 'info', duration = 3000) {
                messageBox.textContent = message;
                messageBox.className = type;
                messageBox.classList.add('show');
                setTimeout(() => {
                    messageBox.classList.remove('show');
                }, duration);
            }

            async function apiFetch(endpoint, options = {}) {
                try {
                    const response = await fetch(`${API_BASE}${endpoint}`, options);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return await response.json();
                } catch (error) {
                    console.error('API Fetch Error:', error);
                    showMessage(`Error: ${error.message}`, 'error');
                    return null;
                }
            }
            
            // --- Dropdown & Data Loading ---
            
            async function initApp() {
                const configData = await apiFetch('/api/get-app-config');
                
                if (!configData) {
                    showMessage('Failed to load app configuration.', 'error');
                    return;
                }

                if (configData.filters) {
                    filterOptions = configData.filters;
                    batchSelect.innerHTML = '<option value="">Select Batch</option>';
                    Object.keys(filterOptions).sort().forEach(batch => {
                        batchSelect.add(new Option(batch, batch));
                    });
                }
                
                if (configData.leaves) {
                    professorLeaveStore = configData.leaves.map(leave => {
                        const start_dt = new Date(leave.start_date + "T00:00:00");
                        const end_dt = new Date(leave.end_date + "T00:00:00");
                        return {
                            professor_name: leave.professor_name,
                            start_ms: start_dt.getTime(),
                            end_ms: end_dt.getTime() + (24 * 60 * 60 * 1000 - 1)
                        };
                    });
                }
            }

            function getCurrentTerm(batch) {
                if (!batch || !filterOptions[batch]) return null;
                const terms = Object.keys(filterOptions[batch]);
                return terms.length > 0 ? terms[0] : null;
            }

            function populateTermDropdown(batch) {
                termSelect.innerHTML = '<option value="">Select Term</option>';
                termSelect.disabled = true;
                sectionSelect.innerHTML = '<option value="">Select Section</option>';
                sectionSelect.disabled = true;
                
                if (batch && filterOptions[batch]) {
                    Object.keys(filterOptions[batch]).sort().forEach(term => {
                        termSelect.add(new Option(term, term));
                    });
                    termSelect.disabled = false;
                    
                    const currentTerm = getCurrentTerm(batch);
                    if (currentTerm) {
                        termSelect.value = currentTerm;
                        currentSelection.term = currentTerm;
                        populateSectionDropdown(batch, currentTerm);
                    }
                }
            }

            function populateSectionDropdown(batch, term) {
                sectionSelect.innerHTML = '<option value="">Select Section</option>';
                sectionSelect.disabled = true;

                if (batch && term && filterOptions[batch] && filterOptions[batch][term]) {
                    const sections = filterOptions[batch][term].sort();
                    sections.forEach(section => {
                        sectionSelect.add(new Option(section, section));
                    });
                    sectionSelect.disabled = false;
                    
                    // Use the proven logic from index.html
                    if (sections.length === 1) {
                        // Set UI + internal selection, then fetch directly
                        sectionSelect.value = sections[0];
                        currentSelection.batch = batch;
                        currentSelection.term = term;
                        currentSelection.section = sections[0];
                        // Directly fetch schedule for the single-section case
                        fetchAndDisplaySchedule();
                    }
                }
            }

            function getAllDatesInRange(startDateStr, endDateStr) {
                const dates = [];
                const startDate = new Date(startDateStr + 'T00:00:00');
                const endDate = new Date(endDateStr + 'T00:00:00');
                
                let currentDate = new Date(startDate);
                while (currentDate <= endDate) {
                    dates.push(currentDate.toISOString().split('T')[0]);
                    currentDate.setDate(currentDate.getDate() + 1);
                }
                return dates;
            }

            function populateInlineFilters() {
                const professors = new Set();
                const courses = new Set();
                
                sectionScheduleData.forEach(item => {
                    if (item.professor_name) professors.add(item.professor_name);
                    if (item.course_name) courses.add(item.course_name);
                });
                
                professorFilter.innerHTML = '<option value="all">All Professors</option>';
                Array.from(professors).sort().forEach(prof => {
                    professorFilter.add(new Option(prof, prof));
                });
                
                courseFilter.innerHTML = '<option value="all">All Courses</option>';
                Array.from(courses).sort().forEach(course => {
                    courseFilter.add(new Option(course, course));
                });
            }

            function applyInlineFilters() {
                const selectedProfessor = professorFilter.value;
                const selectedCourse = courseFilter.value;
                
                const allLectureCells = document.querySelectorAll('.lecture-cell, .stacked-lecture-cell');
                
                allLectureCells.forEach(cell => {
                    const professor = cell.dataset.professor || '';
                    const course = cell.dataset.course || '';
                    
                    let shouldShow = true;
                    
                    if (selectedProfessor !== 'all' && selectedCourse !== 'all') {
                        shouldShow = professor === selectedProfessor && course === selectedCourse;
                    } else if (selectedProfessor !== 'all') {
                        shouldShow = professor === selectedProfessor;
                    } else if (selectedCourse !== 'all') {
                        shouldShow = course === selectedCourse;
                    }
                    
                    cell.classList.toggle('faded', !shouldShow);
                });
            }

            async function fetchAndDisplaySchedule() {
                // Use the currentSelection object directly
                const { batch, term, section } = currentSelection;

                if (!batch || !term || !section) {
                    console.log('No valid selection - batch, term, or section missing');
                    sectionScheduleData = [];
                    scheduleDataStore = [];
                    renderNewScheduleTable([]);
                    resetChanges();
                    showMessage('Please select a batch, term, and section first', 'info');
                    return;
                }

                showMessage('Loading schedule...', 'info', 1000);
                
                // Disable buttons during load
                saveBtn.disabled = true;
                undoBtn.disabled = true;
                resetBtn.disabled = true;
                addClassBtn.disabled = true;
                editCourseBtn.disabled = true;

                const url = `/api/get-schedules?batch=${encodeURIComponent(batch)}&term=${encodeURIComponent(term)}&section=${encodeURIComponent(section)}`;
                
                const data = await apiFetch(url, { method: 'GET', cache: 'no-store' });

                if (!data) {
                    showMessage('Failed to load schedule.', 'error');
                    updateButtonState();
                    return;
                }

                const deepClone = obj => (typeof structuredClone === 'function') ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
                sectionScheduleData = deepClone(data.section_schedule || []);
                scheduleDataStore = deepClone(data.full_schedule || []);

                const key = `${batch}|${term}|${section}`;
                pristineSnapshots[key] = deepClone(scheduleDataStore);
                pristineSectionSnapshots[key] = deepClone(sectionScheduleData);
                pristineScheduleSnapshot = deepClone(scheduleDataStore);

                resetChanges();
                renderNewScheduleTable(sectionScheduleData);
                
                populateInlineFilters();
                applyInlineFilters();

                // Re-enable buttons based on data
                resetBtn.disabled = sectionScheduleData.length === 0;
                addClassBtn.disabled = sectionScheduleData.length === 0;
                editCourseBtn.disabled = sectionScheduleData.length === 0;
                updateButtonState();

                currentSelection.batch = batch;
                currentSelection.term = term;
                currentSelection.section = section;
                if (sectionScheduleData.length === 0) {
                    showMessage('No schedule data found.', 'info');
                } else {
                    showMessage('Schedule loaded.', 'success');
                }
            }

            function handleSelectionChange() {
                const batch = batchSelect.value;
                const term = termSelect.value;
                const section = sectionSelect.value;

                if (batch !== currentSelection.batch) {
                    populateTermDropdown(batch);
                    currentSelection.batch = batch;
                    currentSelection.term = '';
                    currentSelection.section = '';
                } else if (term !== currentSelection.term) {
                    currentSelection.term = term;
                    currentSelection.section = '';
                    populateSectionDropdown(batch, term);
                }
                
                // Update section if it changed OR if we have a single section case
                if (section !== currentSelection.section || 
                    (batch && term && !section && currentSelection.section)) {
                    currentSelection.section = section || currentSelection.section;
                    
                    // Load schedule only when all three are selected
                    if (batch && term && currentSelection.section) {
                        fetchAndDisplaySchedule();
                    } else {
                        renderNewScheduleTable([]);
                        resetChanges();
                    }
                }
            }

            // --- Table Rendering ---

            function renderNewScheduleTable(data) {
                tableHead.innerHTML = '';
                tableBody.innerHTML = '';
                
                tableContainerRect = tableContainer.getBoundingClientRect();

                if (data.length === 0) {
                    tableHead.innerHTML = '<tr><th>No Data</th></tr>';
                    return;
                }

                const allTimeSlots = new Set();
                let minDate = null;
                let maxDate = null;
                
                data.forEach(item => {
                    allTimeSlots.add(item.start_time);
                    const itemDate = new Date(item.date + 'T00:00:00');
                    
                    if (!minDate || itemDate < minDate) minDate = itemDate;
                    if (!maxDate || itemDate > maxDate) maxDate = itemDate;
                });
                
                tableTimeSlots = Array.from(allTimeSlots).sort();

                // Create Header Row
                const headerRow = document.createElement('tr');
                headerRow.appendChild(document.createElement('th'));
                tableTimeSlots.forEach(time => {
                    const th = document.createElement('th');
                    th.textContent = time;
                    headerRow.appendChild(th);
                });
                tableHead.appendChild(headerRow);

                // Create Data Map - Group by date and time for stacked classes
                const scheduleMap = new Map();
                data.forEach(item => {
                    const key = `${item.date}|${item.start_time}`;
                    if (!scheduleMap.has(key)) {
                        scheduleMap.set(key, []);
                    }
                    scheduleMap.get(key).push(item);
                });
                
                // Generate continuous dates
                const allDates = getAllDatesInRange(
                    minDate.toISOString().split('T')[0],
                    maxDate.toISOString().split('T')[0]
                );

                // Create Body Rows
                allDates.forEach(date => {
                    const row = document.createElement('tr');
                    const dateObj = new Date(date + 'T00:00:00');
                    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                    
                    const hasLectures = data.some(item => item.date === date);
                    
                    const dateTh = document.createElement('th');
                    dateTh.innerHTML = `${date}<br><span style="font-weight: 400; font-size: 0.9rem;">${dayName}</span>`;
                    
                    if (!hasLectures) {
                        row.classList.add('empty-date-row');
                    }
                    
                    row.appendChild(dateTh);
                    
                    tableTimeSlots.forEach(time => {
                        const cell = document.createElement('td');
                        const key = `${date}|${time}`;
                        const lectures = scheduleMap.get(key) || [];
                        
                        const cellTimestamp = `${date}T${time}:00`;
                        cell.dataset.timestamp = cellTimestamp;

                        if (lectures.length > 0) {
                            // Create stacked cell if multiple lectures at same time
                            if (lectures.length > 1) {
                                const stackedDiv = createStackedLectureDiv(lectures);
                                cell.appendChild(stackedDiv);
                            } else {
                                const lectureDiv = createLectureDiv(lectures[0]);
                                cell.appendChild(lectureDiv);
                            }
                        } else {
                            const emptyDiv = document.createElement('div');
                            emptyDiv.className = 'empty-cell';
                            emptyDiv.dataset.timestamp = cellTimestamp;
                            cell.appendChild(emptyDiv);
                        }

                        // ADD THIS LINE - append each cell to the row
                        row.appendChild(cell);
                    });
                    
                    tableBody.appendChild(row);
                });
            }
            
            function createLectureDiv(lecture) {
                const div = document.createElement('div');
                div.className = 'lecture-cell';
                div.draggable = true;
                div.dataset.commitmentId = lecture.commitment_id;
                div.dataset.professor = lecture.professor_name;
                div.dataset.course = lecture.course_name;
                div.style.borderLeftColor = getProfColor(lecture.professor_name);
                
                div.innerHTML = `
                    <div class="course-name">${lecture.course_name}</div>
                    <div class="prof-name">${lecture.professor_name}</div>
                `;
                return div;
            }

            function createStackedLectureDiv(lectures) {
                const div = document.createElement('div');
                div.className = 'stacked-lecture-cell';
                div.draggable = true;
                // For stacked cells, we use the first lecture's data for filtering
                div.dataset.commitmentId = lectures[0].commitment_id;
                div.dataset.professor = lectures[0].professor_name;
                div.dataset.course = lectures[0].course_name;
                
                lectures.forEach((lecture, index) => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'stacked-item';
                    itemDiv.style.borderLeftColor = getProfColor(lecture.professor_name);
                    itemDiv.dataset.commitmentId = lecture.commitment_id;
                    itemDiv.dataset.professor = lecture.professor_name;
                    itemDiv.dataset.course = lecture.course_name;
                    
                    itemDiv.innerHTML = `
                        <div class="course-name">${lecture.course_name}</div>
                        <div class="prof-name">${lecture.professor_name}</div>
                    `;
                    div.appendChild(itemDiv);
                });
                
                return div;
            }

            function getProfColor(profName) {
                let hash = 0;
                for (let i = 0; i < profName.length; i++) {
                    hash = profName.charCodeAt(i) + ((hash << 5) - hash);
                }
                let color = '#';
                for (let i = 0; i < 3; i++) {
                    let value = (hash >> (i * 8)) & 0xFF;
                    color += value.toString(16).padStart(2, '0');
                }
                return color;
            }

            // =================================================================
            // NEW FEATURE: ADD CLASS FUNCTIONALITY
            // =================================================================

            function initAddClassModal() {
                // Populate course dropdown
                const courses = [...new Set(scheduleDataStore.map(item => item.course_name))].sort();
                const newCourseSelect = document.getElementById('new-course');
                newCourseSelect.innerHTML = '<option value="">Select Course</option>';
                courses.forEach(course => {
                    newCourseSelect.add(new Option(course, course));
                });
                
                // Add "Add New Course" option
                const addNewCourseOption = document.createElement('div');
                addNewCourseOption.className = 'add-new-option';
                addNewCourseOption.innerHTML = `
                    <div class="add-new-input-group" style="display: none; margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px;">
                        <input type="text" id="new-course-input" placeholder="Enter new course name" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px;">
                        <div style="display: flex; gap: 8px;">
                            <button type="button" id="save-new-course" style="padding: 6px 12px; background: #2ecc71; color: white; border: none; border-radius: 4px; cursor: pointer;">Add</button>
                            <button type="button" id="cancel-new-course" style="padding: 6px 12px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                        </div>
                    </div>
                    <button type="button" id="show-new-course-input" style="width: 100%; padding: 8px; background: transparent; border: 1px dashed #3498db; color: #3498db; border-radius: 4px; cursor: pointer; margin-top: 8px;">
                        + Add New Course
                    </button>
                `;
                
                newCourseSelect.parentNode.insertBefore(addNewCourseOption, newCourseSelect.nextSibling);
                
                // Event listeners for add new course
                const showCourseInputBtn = addNewCourseOption.querySelector('#show-new-course-input');
                const courseInputGroup = addNewCourseOption.querySelector('.add-new-input-group');
                const newCourseInput = addNewCourseOption.querySelector('#new-course-input');
                const saveNewCourseBtn = addNewCourseOption.querySelector('#save-new-course');
                const cancelNewCourseBtn = addNewCourseOption.querySelector('#cancel-new-course');
                
                showCourseInputBtn.addEventListener('click', () => {
                    showCourseInputBtn.style.display = 'none';
                    courseInputGroup.style.display = 'block';
                    newCourseInput.focus();
                });
                
                cancelNewCourseBtn.addEventListener('click', () => {
                    courseInputGroup.style.display = 'none';
                    showCourseInputBtn.style.display = 'block';
                    newCourseInput.value = '';
                });
                
                saveNewCourseBtn.addEventListener('click', () => {
                    const newCourseName = newCourseInput.value.trim();
                    if (newCourseName) {
                        const newOption = new Option(newCourseName, newCourseName);
                        newCourseSelect.add(newOption);
                        newCourseSelect.value = newCourseName;
                        courseInputGroup.style.display = 'none';
                        showCourseInputBtn.style.display = 'block';
                        newCourseInput.value = '';
                    }
                });
                
                newCourseInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        saveNewCourseBtn.click();
                    }
                });
                
                // Populate professor dropdown
                const professors = [...new Set(scheduleDataStore.map(item => item.professor_name))].sort();
                const newProfessorSelect = document.getElementById('new-professor');
                newProfessorSelect.innerHTML = '<option value="">Select Professor</option>';
                professors.forEach(prof => {
                    newProfessorSelect.add(new Option(prof, prof));
                });
                
                // Add "Add New Professor" option for add class modal
                const addNewProfessorOption = document.createElement('div');
                addNewProfessorOption.className = 'add-new-option';
                addNewProfessorOption.innerHTML = `
                    <div class="add-new-input-group" style="display: none; margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px;">
                        <input type="text" id="new-professor-input-add" placeholder="Enter new professor name" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px;">
                        <div style="display: flex; gap: 8px;">
                            <button type="button" id="save-new-professor-add" style="padding: 6px 12px; background: #2ecc71; color: white; border: none; border-radius: 4px; cursor: pointer;">Add</button>
                            <button type="button" id="cancel-new-professor-add" style="padding: 6px 12px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                        </div>
                    </div>
                    <button type="button" id="show-new-professor-input-add" style="width: 100%; padding: 8px; background: transparent; border: 1px dashed #3498db; color: #3498db; border-radius: 4px; cursor: pointer; margin-top: 8px;">
                        + Add New Professor
                    </button>
                `;
                
                newProfessorSelect.parentNode.insertBefore(addNewProfessorOption, newProfessorSelect.nextSibling);
                
                // Event listeners for add new professor in add class modal
                const showProfessorInputBtn = addNewProfessorOption.querySelector('#show-new-professor-input-add');
                const professorInputGroup = addNewProfessorOption.querySelector('.add-new-input-group');
                const newProfessorInputAdd = addNewProfessorOption.querySelector('#new-professor-input-add');
                const saveNewProfessorBtnAdd = addNewProfessorOption.querySelector('#save-new-professor-add');
                const cancelNewProfessorBtnAdd = addNewProfessorOption.querySelector('#cancel-new-professor-add');
                
                showProfessorInputBtn.addEventListener('click', () => {
                    showProfessorInputBtn.style.display = 'none';
                    professorInputGroup.style.display = 'block';
                    newProfessorInputAdd.focus();
                });
                
                cancelNewProfessorBtnAdd.addEventListener('click', () => {
                    professorInputGroup.style.display = 'none';
                    showProfessorInputBtn.style.display = 'block';
                    newProfessorInputAdd.value = '';
                });
                
                saveNewProfessorBtnAdd.addEventListener('click', () => {
                    const newProfessorName = newProfessorInputAdd.value.trim();
                    if (newProfessorName) {
                        const newOption = new Option(newProfessorName, newProfessorName);
                        newProfessorSelect.add(newOption);
                        newProfessorSelect.value = newProfessorName;
                        professorInputGroup.style.display = 'none';
                        showProfessorInputBtn.style.display = 'block';
                        newProfessorInputAdd.value = '';
                    }
                });
                
                newProfessorInputAdd.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        saveNewProfessorBtnAdd.click();
                    }
                });
                
                // Populate time slot dropdown
                const newTimeSelect = document.getElementById('new-time');
                newTimeSelect.innerHTML = '<option value="">Select Time Slot</option>';
                tableTimeSlots.forEach(time => {
                    newTimeSelect.add(new Option(time, time));
                });
            }

            function showAddClassModal() {
                initAddClassModal();
                addClassModal.classList.add('show');
            }

            function hideAddClassModal() {
                addClassModal.classList.remove('show');
                addClassForm.reset();
                
                // Clean up any add-new elements
                const addNewOptions = document.querySelectorAll('.add-new-option');
                addNewOptions.forEach(option => option.remove());
            }

            async function handleAddClassSubmit(e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const course = document.getElementById('new-course').value;
                const professor = document.getElementById('new-professor').value;
                const date = document.getElementById('new-date').value;
                const time = document.getElementById('new-time').value;
                const duration = parseInt(document.getElementById('new-duration').value, 10);

                if (!course || !professor || !date || !time || !duration) {
                    showMessage('Please fill all required fields', 'error');
                    return;
                }

                // Capture selection at submit time
                const {batch, term, section} = currentSelection;
                
                if (!batch || !term || !section) {
                    showMessage('No selection context available for adding class.', 'error');
                    return;
                }

                // Calculate end time
                const [hours, minutes] = time.split(':').map(Number);
                const totalMinutes = hours * 60 + minutes + duration;
                const endHours = Math.floor(totalMinutes / 60);
                const endMinutes = totalMinutes % 60;
                const endHoursWrapped = endHours % 24;
                const endTimeFormatted = `${endHoursWrapped.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;

                const startDateTime = `${date}T${time}:00`;
                const endDateTime = `${date}T${endTimeFormatted}:00`;

                const newClassData = {
                    course_name: course,
                    professor_name: professor,
                    start_time: startDateTime,
                    end_time: endDateTime,
                    academic_term: term,
                    section: section,
                    batch: batch
                };

                const response = await apiFetch('/api/add-new-class', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newClassData)
                });

                if (response && response.success) {
                    showMessage('Class added successfully', 'success');
                    hideAddClassModal();

                    // keep existing behavior: clear pending local edits
                    resetChanges();

                    // Re-fetch using your existing loader — this should render the same triple
                    fetchAndDisplaySchedule();

                } else {
                    const errorMsg = response && response.error ? response.error : 'Failed to add class';
                    showMessage(errorMsg, 'error');
                }
            }

            // =================================================================
            // ENHANCED FEATURE: EDIT COURSE-PROFESSOR ASSIGNMENTS WITH EFFECTIVE DATE
            // =================================================================

            function initEditCourseModal() {
                // Set default effective date to tomorrow
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                effectiveDateInput.valueAsDate = tomorrow;
                
                // Get unique courses for the selected batch only
                const batchCourses = [...new Set(
                    scheduleDataStore
                        .filter(item => item.batch === currentSelection.batch)
                        .map(item => item.course_name)
                )].sort();
                
                // Clear and populate course list
                courseList.innerHTML = '';
                
                if (batchCourses.length === 0) {
                    courseList.innerHTML = '<div class="course-item">No courses found for the selected batch</div>';
                    return;
                }
                
                batchCourses.forEach(course => {
                    const courseItem = document.createElement('div');
                    courseItem.className = 'course-item';
                    courseItem.textContent = course;
                    courseItem.dataset.course = course;
                    
                    courseItem.addEventListener('click', () => {
                        // Remove selected class from all items
                        document.querySelectorAll('.course-item').forEach(item => {
                            item.classList.remove('selected');
                        });
                        // Add selected class to clicked item
                        courseItem.classList.add('selected');
                        
                        // Show course details
                        showCourseDetails(course);
                    });
                    
                    courseList.appendChild(courseItem);
                });
                
                // Hide course details initially
                courseDetails.style.display = 'none';
            }

            function showCourseDetails(courseName) {
                // Clean up any existing add-new-option elements first
                const existingAddNewOptions = document.querySelectorAll('.add-new-option');
                existingAddNewOptions.forEach(option => option.remove());
                
                // Get current professor for this course in the selected batch
                const courseLectures = scheduleDataStore.filter(item => 
                    item.course_name === courseName && 
                    item.batch === currentSelection.batch
                );
                
                // Find the most common professor for this course
                const professorCounts = {};
                courseLectures.forEach(lecture => {
                    if (lecture.professor_name) {
                        professorCounts[lecture.professor_name] = (professorCounts[lecture.professor_name] || 0) + 1;
                    }
                });
                
                let currentProfessor = 'Not assigned';
                let maxCount = 0;
                
                for (const [prof, count] of Object.entries(professorCounts)) {
                    if (count > maxCount) {
                        maxCount = count;
                        currentProfessor = prof;
                    }
                }
                
                // Update UI
                document.getElementById('selected-course-name').textContent = courseName;
                currentProfessorSpan.textContent = currentProfessor;
                
                // Populate professor dropdown with existing professors
                const professors = [...new Set(scheduleDataStore.map(item => item.professor_name))].sort();
                const editProfessorSelect = document.getElementById('edit-professor');
                editProfessorSelect.innerHTML = '<option value="">Select Professor</option>';
                
                // Add existing professors
                professors.forEach(prof => {
                    const option = new Option(prof, prof);
                    if (prof === currentProfessor && currentProfessor !== 'Not assigned') {
                        option.selected = true;
                    }
                    editProfessorSelect.add(option);
                });
                
                // Create and add "Add New" input option (only once)
                const addNewOption = document.createElement('div');
                addNewOption.className = 'add-new-option';
                addNewOption.innerHTML = `
                    <div class="add-new-input-group" style="display: none; margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px;">
                        <input type="text" id="new-professor-input" placeholder="Enter new professor name" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px;">
                        <div style="display: flex; gap: 8px;">
                            <button type="button" id="save-new-professor" style="padding: 6px 12px; background: #2ecc71; color: white; border: none; border-radius: 4px; cursor: pointer;">Add</button>
                            <button type="button" id="cancel-new-professor" style="padding: 6px 12px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                        </div>
                    </div>
                    <button type="button" id="show-new-professor-input" style="width: 100%; padding: 8px; background: transparent; border: 1px dashed #3498db; color: #3498db; border-radius: 4px; cursor: pointer; margin-top: 8px;">
                        + Add New Professor
                    </button>
                `;
                
                // Insert the add new option after the select
                editProfessorSelect.parentNode.insertBefore(addNewOption, editProfessorSelect.nextSibling);
                
                // Event listeners for add new professor
                const showInputBtn = addNewOption.querySelector('#show-new-professor-input');
                const inputGroup = addNewOption.querySelector('.add-new-input-group');
                const newProfessorInput = addNewOption.querySelector('#new-professor-input');
                const saveNewProfessorBtn = addNewOption.querySelector('#save-new-professor');
                const cancelNewProfessorBtn = addNewOption.querySelector('#cancel-new-professor');
                
                showInputBtn.addEventListener('click', () => {
                    showInputBtn.style.display = 'none';
                    inputGroup.style.display = 'block';
                    newProfessorInput.focus();
                });
                
                cancelNewProfessorBtn.addEventListener('click', () => {
                    inputGroup.style.display = 'none';
                    showInputBtn.style.display = 'block';
                    newProfessorInput.value = '';
                });
                
                saveNewProfessorBtn.addEventListener('click', () => {
                    const newProfessorName = newProfessorInput.value.trim();
                    if (newProfessorName) {
                        // Add the new professor to the dropdown
                        const newOption = new Option(newProfessorName, newProfessorName);
                        editProfessorSelect.add(newOption);
                        editProfessorSelect.value = newProfessorName;
                        
                        // Hide input and show button again
                        inputGroup.style.display = 'none';
                        showInputBtn.style.display = 'block';
                        newProfessorInput.value = '';
                    }
                });
                
                // Also allow Enter key to save
                newProfessorInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        saveNewProfessorBtn.click();
                    }
                });
                
                // Show details section
                courseDetails.style.display = 'block';
            }

            // Add this new function to show the add professor modal
            function showAddProfessorModal() {
                const newProfessorName = prompt('Enter new professor name:');
                if (newProfessorName && newProfessorName.trim() !== '') {
                    // Add the new professor to the dropdown
                    const editProfessorSelect = document.getElementById('edit-professor');
                    
                    // Remove the "Add New" option temporarily
                    const addNewOption = editProfessorSelect.querySelector('option[value="add_new"]');
                    if (addNewOption) {
                        addNewOption.remove();
                    }
                    
                    // Add the new professor
                    const newOption = new Option(newProfessorName, newProfessorName);
                    editProfessorSelect.add(newOption);
                    
                    // Select the new professor
                    editProfessorSelect.value = newProfessorName;
                    
                    // Re-add the "Add New" option at the end
                    const newAddNewOption = new Option('+ Add New Professor', 'add_new');
                    editProfessorSelect.add(newAddNewOption);
                } else if (newProfessorName !== null) {
                    // User clicked OK but entered empty name
                    alert('Professor name cannot be empty');
                    // Reset to empty selection
                    const editProfessorSelect = document.getElementById('edit-professor');
                    editProfessorSelect.value = '';
                }
            }

            function showEditCourseModal() {
                if (!currentSelection.batch) {
                    showMessage('Please select a batch first', 'error');
                    return;
                }
                
                initEditCourseModal();
                editCourseModal.classList.add('show');
            }

            function hideEditCourseModal() {
                editCourseModal.classList.remove('show');
                courseDetails.style.display = 'none';
                
                // Clean up any add-new elements
                const addNewOptions = document.querySelectorAll('.add-new-option');
                addNewOptions.forEach(option => option.remove());
            }

            async function handleUpdateCourse() {
                const selectedCourseItem = document.querySelector('.course-item.selected');
                if (!selectedCourseItem) {
                    showMessage('Please select a course to edit', 'error');
                    return;
                }

                const courseName = selectedCourseItem.dataset.course;
                const newProfessor = document.getElementById('edit-professor').value;
                const effectiveDate = effectiveDateInput.value;

                if (!newProfessor) {
                    showMessage('Please select a professor', 'error');
                    return;
                }
                if (!effectiveDate) {
                    showMessage('Please select an effective date', 'error');
                    return;
                }

                // Capture selection at submit time (important)
                const batch = currentSelection.batch;
                const term = currentSelection.term;
                const section = currentSelection.section;

                if (!batch || !term || !section) {
                    showMessage('No selection context available for update.', 'error');
                    return;
                }

                // Quick guard: compare current professor
                const currentProfessor = currentProfessorSpan.textContent;
                if (currentProfessor === newProfessor) {
                    showMessage('Selected professor is already assigned to this course', 'info');
                    return;
                }

                const updateData = [{
                    batch: batch,
                    academic_term: term,
                    section: section,
                    course_name: courseName,
                    new_professor: newProfessor,
                    effective_date: effectiveDate
                }];

                const response = await apiFetch('/api/update-course-professors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData)
                });

                if (response && response.success) {
                    showMessage(`Course professor updated successfully. Updated ${response.updated} classes`, 'success');
                    hideEditCourseModal();

                    // keep existing behavior: clear pending local edits
                    resetChanges();

                    // Ensure we load exactly the selection we updated
                    currentSelection = { batch: batch, term: term, section: section };

                    // Re-fetch using your existing loader — same as saveChanges()
                    fetchAndDisplaySchedule();

                    showMessage(`Reloaded schedule for ${batch} ${term} ${section}`, 'success');
                } else {
                    const errorMsg = response && response.error ? response.error : 'Failed to update course professor';
                    showMessage(errorMsg, 'error');
                }
            }

            // =================================================================
            // ENHANCED HIGHLIGHTING LOGIC - FIXED FOR EMPTY DAYS
            // =================================================================

            function highlightAllSlots(sourceCommitmentId, sourceProfessor) {
                const allCells = tableBody.querySelectorAll('td');

                // Clear previous highlights from both td and inner nodes
                allCells.forEach(td => {
                    td.classList.remove('valid-slot', 'invalid-slot', 'self-slot', 'highlight-unavailable');
                    const inner = td.querySelector('.empty-cell, .lecture, .commitment');
                    if (inner) inner.classList.remove('valid-slot', 'invalid-slot', 'self-slot', 'highlight-unavailable');
                });

                // Robust ts getter
                const getTs = td => {
                    if (!td) return null;
                    if (td.dataset && td.dataset.timestamp) return td.dataset.timestamp;
                    const inner = td.querySelector && td.querySelector('.empty-cell');
                    if (inner && inner.dataset && inner.dataset.timestamp) return inner.dataset.timestamp;
                    return td.getAttribute && td.getAttribute('data-timestamp');
                };

                // Helper to add classes to both td and inner node
                const mark = (td, cls) => {
                    td.classList.add(cls);
                    const inner = td.querySelector('.empty-cell, .lecture, .commitment');
                    if (inner) inner.classList.add(cls);
                };

                // Iterate and validate using canonical validator when available
                allCells.forEach(td => {
                    const ts = getTs(td);
                    if (!ts) return; // not a slot

                    // Check if this is an empty date row (missing day)
                    const isMissingDay = td.closest('.empty-date-row');
                    
                    if (isMissingDay) {
                        // Mark missing days as unavailable (yellow)
                        mark(td, 'highlight-unavailable');
                        return;
                    }

                    // detect target lecture containment (for swaps/self)
                    const targetInner = td.querySelector('.lecture, .commitment, [data-commitment-id], [data-commitmentid]');
                    const targetCommit = targetInner && ((targetInner.dataset && (targetInner.dataset.commitmentId || targetInner.dataset.commitmentid)) || targetInner.getAttribute('data-commitment-id')) || null;

                    // Use canonical validator if present
                    if (typeof isMoveValid === 'function') {
                        let v;
                        try {
                            v = isMoveValid(sourceCommitmentId, ts);
                        } catch (err) {
                            // fail closed
                            mark(td, 'invalid-slot');
                            console.debug('isMoveValid threw for', ts, err);
                            return;
                        }

                        // Normalize potential shapes (type / isValid)
                        const type = v && (v.type || (v.isValid ? 'valid' : 'invalid')) || 'invalid';

                        if (type === 'valid') {
                            mark(td, 'valid-slot');
                        } else if (type === 'self') {
                            mark(td, 'self-slot');
                        } else {
                            mark(td, 'invalid-slot');
                        }
                        return;
                    }

                    // Fallback: conservative invalid if no validator (shouldn't happen in prod)
                    mark(td, 'invalid-slot');
                });
            }

            function clearAllHighlights() {
                // Remove highlight classes from any element that might have them (td or inner nodes)
                const higClasses = ['valid-slot', 'invalid-slot', 'self-slot', 'highlight-unavailable'];
                higClasses.forEach(cls => {
                    document.querySelectorAll(`.${cls}`).forEach(el => {
                        el.classList.remove(cls);
                    });
                });
            }

            /**
             * The definitive validation function. Called by both dragstart and drop.
             * @returns {object} - { isValid: boolean, reason: string, type: string }
             */
            function isMoveValid(draggedCommitmentId, targetTimestamp) {
                
                // 1. Get Source Lecture Info
                const sourceLecture = scheduleDataStore.find(lec => lec.commitment_id.toString() === String(draggedCommitmentId));
                if (!sourceLecture) {
                    return { isValid: false, reason: 'Source lecture not found.', type: 'invalid' };
                }
                
                const sourceProf = sourceLecture.professor_name;
                const sourceStart_ms = new Date(sourceLecture.start_time_ts).getTime();
                const sourceEnd_ms = new Date(sourceLecture.end_time).getTime();
                const sourceDuration = sourceEnd_ms - sourceStart_ms;
                
                // Get source's original date for swap-leave check
                const sourceOriginalDateStr = sourceLecture.start_time_ts.split('T')[0];
                const sourceOriginalDate_ms = new Date(sourceOriginalDateStr + "T00:00:00").getTime();

                if (isNaN(sourceStart_ms) || isNaN(sourceEnd_ms) || isNaN(sourceDuration) || isNaN(sourceOriginalDate_ms)) {
                     console.error('Source lecture has invalid time data!', sourceLecture);
                     return { isValid: false, reason: 'Source lecture time data is corrupt.', type: 'invalid' };
                }
                
                // 2. Get Target Slot Info
                const targetCell = tableBody.querySelector(`td[data-timestamp="${targetTimestamp}"]`);
                if (!targetCell) {
                    return { isValid: false, reason: 'Target cell not found.', type: 'invalid' };
                }
                
                
                // Get commitmentId from the CHILD, not the TD
                const targetContent = targetCell.firstElementChild;
                const targetCommitmentId = (targetContent && targetContent.classList.contains('lecture-cell')) 
                                           ? targetContent.dataset.commitmentId 
                                           : null;

                const targetStart_ms = new Date(targetTimestamp).getTime();
                
                // Get target's date for leave check
                const targetDateStr = targetTimestamp.split('T')[0];
                const targetDate_ms = new Date(targetDateStr + "T00:00:00").getTime();
                
                // NEW LEAVE CHECK (Move)
                // Check if the *source professor* is on leave on the *target date*
                if (isProfessorOnLeave(sourceProf, targetDate_ms)) {
                    return { isValid: false, reason: `${sourceProf} is on leave on ${targetDateStr}.`, type: 'invalid' };
                }
                
                // Case 1: Target is OCCUPIED (Swap)
                if (targetCommitmentId) {
                    // Safety check: don't swap with self
                    if (String(targetCommitmentId) === String(draggedCommitmentId)) {
                        return { isValid: false, type: 'self' };
                    }

                    const targetLecture = scheduleDataStore.find(lec => lec.commitment_id.toString() === String(targetCommitmentId));
                    if (!targetLecture) {
                        return { isValid: false, reason: 'Target lecture not found.', type: 'invalid' };
                    }
                    
                    const targetProf = targetLecture.professor_name;
                    
                    // Check for swap with self (Grey)
                    if (sourceProf === targetProf) {
                        return { isValid: false, reason: 'Cannot swap a professor with their own class.', type: 'self' };
                    }
                    
                    // NEW LEAVE CHECK (Swap)
                    // Check if the *target professor* is on leave on the *source's original date*
                    if (isProfessorOnLeave(targetProf, sourceOriginalDate_ms)) {
                        return { isValid: false, reason: `${targetProf} is on leave on ${sourceOriginalDateStr}.`, type: 'invalid' };
                    }
                    
                    const targetEnd_ms = new Date(targetLecture.end_time).getTime();
                    if (isNaN(targetEnd_ms)) {
                        console.error('Target lecture has invalid time data!', targetLecture);
                        return { isValid: false, reason: 'Target lecture time data is corrupt.', type: 'invalid' };
                    }

                    // Check: Is Source Prof free during Target's slot?
                    const isSourceProfFree = isProfessorFree(sourceProf, targetStart_ms, targetEnd_ms, draggedCommitmentId);
                    
                    // Check: Is Target Prof free during Source's slot?
                    const isTargetProfFree = isProfessorFree(targetProf, sourceStart_ms, sourceEnd_ms, targetCommitmentId);
                    
                    if (isSourceProfFree && isTargetProfFree) {
                        return { isValid: true, reason: 'Valid swap.', type: 'valid' };
                    } else {
                        let reason = 'Conflict: Professor or section is busy.';
                        if (!isSourceProfFree) reason = `Conflict: ${sourceProf} is busy at that time.`; 
                        if (!isTargetProfFree) reason = `Conflict: ${targetProf} is busy at ${sourceLecture.start_time}.`;
                        return { isValid: false, reason: reason, type: 'invalid' };
                    }
                    
                // Case 2: Target is EMPTY (Move)
                } else {
                    const targetEnd_ms = targetStart_ms + sourceDuration;
                    
                    // Check: Is Source Prof free during this new slot?
                    // MUST ignore the class being dragged!
                    if (isProfessorFree(sourceProf, targetStart_ms, targetEnd_ms, draggedCommitmentId)) {
                        return { isValid: true, reason: 'Valid move to empty slot.', type: 'valid' };
                    } else {
                        return { isValid: false, reason: 'Conflict: Professor is busy at this time.', type: 'invalid' };
                    }
                }
            }

            function isProfessorOnLeave(professor, date_ms) {
                // Find *any* leave entry that matches
                return professorLeaveStore.find(leave => {
                    return leave.professor_name === professor &&
                           date_ms >= leave.start_ms &&
                           date_ms <= leave.end_ms;
                });
            }

            function isProfessorFree(professor, targetStart_ms, targetEnd_ms, ignoreCommitmentId) {
                
                const clash = scheduleDataStore.find(lec => {
                    // 1. Same professor
                    if (lec.professor_name !== professor) return false;
                    
                    // 2. Not the lecture we're ignoring
                    // Must cast both to string for reliable compare
                    if (String(ignoreCommitmentId) && lec.commitment_id.toString() === String(ignoreCommitmentId)) return false;
                    
                    // 3. Check for overlap
                    // Use new Date().getTime() for max reliability
                    const lecStart_ms = new Date(lec.start_time_ts).getTime();
                    const lecEnd_ms = new Date(lec.end_time).getTime();

                    if (isNaN(lecStart_ms) || isNaN(lecEnd_ms)) {
                        console.warn('Invalid date in data store:', lec);
                        return false;
                    }

                    // (startA < endB) AND (endA > startB)
                    const hasOverlap = (targetStart_ms < lecEnd_ms) && (targetEnd_ms > lecStart_ms);
                    
                    return hasOverlap;
                });
                
                return !clash; // Free if no clash
            }

            // =================================================================
            // UNDO AND SAVE CHANGES LOGIC (From index.html)
            // =================================================================

            function formatLocalDate(dt) {
                const Y = dt.getFullYear();
                const M = String(dt.getMonth() + 1).padStart(2, '0');
                const D = String(dt.getDate()).padStart(2, '0');
                const h = String(dt.getHours()).padStart(2, '0');
                const m = String(dt.getMinutes()).padStart(2, '0');
                const s = String(dt.getSeconds()).padStart(2, '0');
                return `${Y}-${M}-${D}T${h}:${m}:${s}`;
            }

            /**
             * Utility: normalize timestamp input (accepts ms or ISO).
             */
            function normalizeTimestamp(input) {
                if (input === null || typeof input === 'undefined') return null;
                if (typeof input === 'number') {
                    return formatLocalDate(new Date(input));
                }
                // if numeric string in ms
                if (/^\d{10,}$/.test(String(input))) {
                    return formatLocalDate(new Date(Number(input)));
                }
                // if already ISO-like but missing seconds, ensure seconds present
                if (typeof input === 'string' && input.includes('T') && input.split('T')[1].length === 5) {
                    return input + ':00';
                }
                return input;
            }

            /**
             * Logs a change to the pendingChanges array.
             * This version robustly finds the *true* original timestamp.
             */
            const logChange = (sourceId, newTimestamp, swappedId) => {
                let sourceOriginalTs = null;
                
                // Find the *true* original state from the pristine `sectionScheduleData`
                const originalLec = sectionScheduleData.find(lec => lec.commitment_id.toString() === String(sourceId));
                
                if (originalLec) {
                    sourceOriginalTs = originalLec.start_time_ts; // Use the correct timestamp key
                } else {
                    // This lecture was swapped *in*. Find its *first* move in pendingChanges.
                    const firstMove = pendingChanges.find(c => c.source_commitment_id === sourceId);
                    // If it's not in pending, it must have been in the data store
                    sourceOriginalTs = firstMove 
                        ? firstMove.source_original_timestamp 
                        : scheduleDataStore.find(l => l.commitment_id.toString() === String(sourceId))?.start_time_ts;
                }
                
                // Find and remove any *previous* moves for this same commitment
                pendingChanges = pendingChanges.filter(change => 
                    change.source_commitment_id !== String(sourceId)
                );
                
                if (swappedId) {
                    pendingChanges = pendingChanges.filter(change => 
                        change.source_commitment_id !== String(swappedId)
                    );
                }

                // Add the new change for the source lecture
                pendingChanges.push({
                    source_commitment_id: String(sourceId),
                    target_slot_timestamp: newTimestamp,
                    source_original_timestamp: sourceOriginalTs,
                    target_commitment_id: swappedId ? String(swappedId) : null
                });
                
                // If it was a swap, add the change for the target lecture
                if (swappedId) {
                    let targetOriginalTs = sectionScheduleData.find(lec => lec.commitment_id.toString() === String(swappedId))?.start_time_ts;
                    if (!targetOriginalTs) {
                         const firstMove = pendingChanges.find(c => c.source_commitment_id === swappedId);
                         targetOriginalTs = firstMove 
                            ? firstMove.source_original_timestamp 
                            : scheduleDataStore.find(l => l.commitment_id.toString() === String(swappedId))?.start_time_ts;
                    }
                    
                    const sourceLecture = scheduleDataStore.find(l => l.commitment_id.toString() === String(sourceId));
                    
                    pendingChanges.push({
                        source_commitment_id: String(swappedId),
                        target_slot_timestamp: sourceLecture.start_time_ts, 
                        source_original_timestamp: targetOriginalTs,
                        target_commitment_id: String(sourceId)
                    });
                }
                
                updateButtonState();
            };

            /**
             * Updates the in-memory "dataframe" after a move.
             * This version robustly maintains local time strings.
             */
            const updateInMemorySchedule = (sourceCommitmentId, targetTimestamp, targetCommitmentId) => {
                const sourceLecture = scheduleDataStore.find(lec => lec.commitment_id.toString() === String(sourceCommitmentId));
                if (!sourceLecture) {
                     console.error("CRITICAL: Source lecture not found in update");
                     return;
                }
                const sourceOldStart_ISO = sourceLecture.start_time_ts;
                const sourceDuration = new Date(sourceLecture.end_time).getTime() - new Date(sourceLecture.start_time_ts).getTime();
                
                // DATA CORRUPTION FIX: Update all time-related fields
                const newStart_ms = new Date(targetTimestamp).getTime();
                const newEnd_dt = new Date(newStart_ms + sourceDuration);
                
                sourceLecture.start_time_ts = targetTimestamp; // e.g., "2025-08-04T09:30:00"
                sourceLecture.end_time = formatLocalDate(newEnd_dt);
                // Also update the helper fields
                sourceLecture.date = targetTimestamp.split('T')[0];
                sourceLecture.start_time = targetTimestamp.split('T')[1].substring(0, 5);

                if (targetCommitmentId) {
                    // It was a swap, update target
                    const targetLecture = scheduleDataStore.find(lec => lec.commitment_id.toString() === String(targetCommitmentId));
                    if (!targetLecture) {
                        console.error("CRITICAL: Target lecture not found in update");
                        return;
                    }
                    const targetDuration = new Date(targetLecture.end_time).getTime() - new Date(targetLecture.start_time_ts).getTime();
                    
                    // DATA CORRUPTION FIX: Update all time-related fields
                    const targetNewStart_ms = new Date(sourceOldStart_ISO).getTime();
                    const targetNewEnd_dt = new Date(targetNewStart_ms + targetDuration);

                    targetLecture.start_time_ts = sourceOldStart_ISO;
                    targetLecture.end_time = formatLocalDate(targetNewEnd_dt);
                    // Also update the helper fields
                    targetLecture.date = sourceOldStart_ISO.split('T')[0];
                    targetLecture.start_time = sourceOldStart_ISO.split('T')[1].substring(0, 5);
                }
            };

            /**
             * Undoes the last move.
             * This implementation performs a single-step undo by popping the last pending change
             * and reverting the DOM and in-memory store for the affected lectures.
             */
            function undoLastChange() {
                if (!pendingChanges || pendingChanges.length === 0) return;

                const last = pendingChanges.pop();
                
                // Check if this is part of a swap pair
                let partner = null;
                if (last.target_commitment_id && pendingChanges.length > 0) {
                    const prev = pendingChanges[pendingChanges.length - 1];
                    if (prev.source_commitment_id === last.target_commitment_id) {
                        partner = pendingChanges.pop();
                    }
                }

                if (partner) {
                    // SWAP UNDO (Atomic)
                    const changeA = partner; 
                    const changeB = last;    

                    const idA = changeA.source_commitment_id;
                    const tsA_Orig = normalizeTimestamp(changeA.source_original_timestamp);
                    
                    const idB = changeB.source_commitment_id;
                    const tsB_Orig = normalizeTimestamp(changeB.source_original_timestamp);

                    // FIX: Look for the actual dragged element (could be lecture-cell or stacked-lecture-cell)
                    const findDraggedElement = (commitmentId) => {
                        // First try to find a regular lecture cell
                        let element = document.querySelector(`.lecture-cell[data-commitment-id="${commitmentId}"]`);
                        if (element) return element;
                        
                        // If not found, try to find a stacked item and return its parent stacked cell
                        const stackedItem = document.querySelector(`.stacked-item[data-commitment-id="${commitmentId}"]`);
                        if (stackedItem) {
                            return stackedItem.closest('.stacked-lecture-cell');
                        }
                        
                        return null;
                    };

                    const elA = findDraggedElement(idA);
                    const elB = findDraggedElement(idB);
                    
                    const cellA = document.querySelector(`td[data-timestamp="${tsA_Orig}"]`);
                    const cellB = document.querySelector(`td[data-timestamp="${tsB_Orig}"]`);

                    // DOM Swap back
                    if (elA && elB && cellA && cellB) {
                        // Clear both cells first
                        cellA.innerHTML = '';
                        cellB.innerHTML = '';
                        
                        // Place elements back
                        cellA.appendChild(elA);
                        cellB.appendChild(elB);
                    }

                    // Memory Update
                    const updateMem = (id, ts) => {
                        const l = scheduleDataStore.find(x => String(x.commitment_id) === String(id));
                        if(l) {
                            l.start_time_ts = ts;
                            l.date = ts.split('T')[0];
                            l.start_time = ts.split('T')[1].substring(0,5);
                        }
                    };
                    updateMem(idA, tsA_Orig);
                    updateMem(idB, tsB_Orig);

                } else {
                    // SINGLE MOVE UNDO
                    const record = last;
                    const srcId = String(record.source_commitment_id);
                    const fromTs = normalizeTimestamp(record.source_original_timestamp);
                    const toTs = normalizeTimestamp(record.target_slot_timestamp);

                    // FIX: Use the same logic to find dragged element
                    const findDraggedElement = (commitmentId) => {
                        let element = document.querySelector(`.lecture-cell[data-commitment-id="${commitmentId}"]`);
                        if (element) return element;
                        
                        const stackedItem = document.querySelector(`.stacked-item[data-commitment-id="${commitmentId}"]`);
                        if (stackedItem) {
                            return stackedItem.closest('.stacked-lecture-cell');
                        }
                        
                        return null;
                    };

                    const movedEl = findDraggedElement(srcId);
                    
                    const fromTd = document.querySelector(`td[data-timestamp="${fromTs}"]`);
                    const toTd = document.querySelector(`td[data-timestamp="${toTs}"]`);

                    if (movedEl && fromTd) {
                        fromTd.innerHTML = ''; 
                        fromTd.appendChild(movedEl);
                    }

                    // Restore empty cell at old target if it's now empty
                    if (toTd && !toTd.querySelector('.lecture-cell, .stacked-lecture-cell')) {
                        toTd.innerHTML = `<div class="empty-cell" data-timestamp="${toTs}"></div>`;
                    }

                    // Memory Update
                    const l = scheduleDataStore.find(x => String(x.commitment_id) === srcId);
                    if(l) {
                        l.start_time_ts = fromTs;
                        l.date = fromTs.split('T')[0];
                        l.start_time = fromTs.split('T')[1].substring(0,5);
                    }
                }

                clearAllHighlights();
                updateButtonState();
                undoBtn.disabled = pendingChanges.length === 0;
            }

            /**
             * Sends all pending changes to the server.
             */
            async function saveChanges() {
                if (pendingChanges.length === 0) {
                    showMessage('No changes to save.', 'info');
                    return;
                }
                
                const response = await apiFetch('/api/save-changess', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pendingChanges)
                });
                
                if (response && response.success) {
                    showMessage(`Successfully saved ${response.changes_committed} changes.`, 'success');
                    resetChanges(); // Clear local state on success
                    // Re-fetch to be 100% in sync with DB
                    fetchAndDisplaySchedule();
                } else {
                    showMessage('Error saving changes. Please check console.', 'error');
                }
            }

            // =================================================================
            // DRAG & DROP FUNCTIONS (Updated to use enhanced highlighting)
            // =================================================================

            function initDragDrop() {
                tableBody.addEventListener('dragstart', (e) => {
                    const el = e.target;
                    if (!el || (!el.classList.contains('lecture-cell') && !el.classList.contains('stacked-lecture-cell'))) {
                        draggedItem = null;
                        return;
                    }

                    draggedItem = el;
                    sourceCell = draggedItem.closest('td');
                    sourceCommitmentId = draggedItem.dataset.commitmentId;
                    sourceProfessor = draggedItem.dataset.professor;

                    draggedItem.classList.add('dragging');

                    dragClone.innerHTML = '';
                    const cloneContent = draggedItem.cloneNode(true);
                    dragClone.appendChild(cloneContent);
                    e.dataTransfer.setDragImage(dragClone, 0, 0);
                    e.dataTransfer.effectAllowed = 'move';

                    // Use enhanced highlighting logic
                    highlightAllSlots(sourceCommitmentId, sourceProfessor);
                });

                tableBody.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    
                    const targetCell = e.target.closest('td');
                    if (targetCell) {
                        e.dataTransfer.dropEffect = 'move';
                    }
                    
                    tableContainerRect = tableContainer.getBoundingClientRect();
                    const scrollZone = 150;
                    const containerTop = tableContainerRect.top;
                    const containerBottom = tableContainerRect.bottom;
                    const mouseY = e.clientY;
                    
                    if (mouseY < (containerTop + scrollZone)) {
                        scrollSpeed = -10;
                    } else if (mouseY > (containerBottom - scrollZone)) {
                        scrollSpeed = 10;
                    } else {
                        scrollSpeed = 0;
                    }
                });

                tableBody.addEventListener('dragend', (e) => {
                    if (draggedItem) {
                        draggedItem.classList.remove('dragging');
                        clearAllHighlights();
                        draggedItem = null;
                        sourceCell = null;
                        sourceCommitmentId = null;
                        sourceProfessor = null;
                        scrollSpeed = 0;
                        dragClone.innerHTML = '';
                    }
                });
                
                tableBody.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (!draggedItem) return;

                    const targetCell = e.target.closest('td');
                    if (!targetCell) return;

                    const targetTimestamp = targetCell.dataset.timestamp;
                    const validation = isMoveValid(sourceCommitmentId, targetTimestamp);
                    
                    if (!validation.isValid) {
                        showMessage(validation.reason, 'error');
                        draggedItem.classList.remove('dragging');
                        clearAllHighlights();
                        resetDragState();
                        return;
                    }

                    const targetContent = targetCell.firstElementChild;
                    const targetHasLecture = targetContent && (targetContent.classList.contains('lecture-cell') || targetContent.classList.contains('stacked-lecture-cell'));
                    const targetCommitmentId = targetHasLecture ? targetContent.dataset.commitmentId : null;

                    try {
                        if (targetHasLecture) {
                            const movingTargetNode = targetContent;
                            sourceCell.innerHTML = '';
                            targetCell.innerHTML = '';
                            sourceCell.appendChild(movingTargetNode);
                            targetCell.appendChild(draggedItem);
                        } else {
                            targetCell.innerHTML = '';
                            targetCell.appendChild(draggedItem);
                            if (sourceCell) {
                                sourceCell.innerHTML = `<div class="empty-cell" data-timestamp="${sourceCell.dataset.timestamp}"></div>`;
                            }
                        }
                    } catch (err) {
                        console.error('DOM swap error:', err);
                    }

                    // Use imported logChange and update functions
                    logChange(sourceCommitmentId, targetTimestamp, targetCommitmentId);
                    updateInMemorySchedule(sourceCommitmentId, targetTimestamp, targetCommitmentId);
                    
                    undoStack.push(true);
                    undoBtn.disabled = false;

                    clearAllHighlights();
                    resetDragState();
                    updateButtonState();
                    showMessage('Move completed', 'success', 1500);
                });

                function resetDragState() {
                    if (draggedItem) draggedItem.classList.remove('dragging');
                    draggedItem = null;
                    sourceCell = null;
                    sourceCommitmentId = null;
                    sourceProfessor = null;
                    dragClone.innerHTML = '';
                    scrollSpeed = 0;
                }
            }

            // --- Save/Reset Functions ---

            async function resetSchedule() {
                if (pendingChanges.length > 0) {
                    if (!confirm('Are you sure you want to discard all pending changes?')) {
                        return;
                    }
                }

                const { batch, term, section } = currentSelection;
                if (!batch || !term || !section) {
                    showMessage('No selection to reset.', 'info');
                    return;
                }

                const key = `${batch}|${term}|${section}`;
                if (pristineSectionSnapshots[key]) {
                    sectionScheduleData = JSON.parse(JSON.stringify(pristineSectionSnapshots[key]));
                    scheduleDataStore = JSON.parse(JSON.stringify(pristineSnapshots[key]));
                    renderNewScheduleTable(sectionScheduleData);
                    populateInlineFilters();
                    applyInlineFilters();
                    resetChanges();
                    showMessage('Changes reset to original state.', 'success');
                } else {
                    fetchAndDisplaySchedule();
                }
            }

            function resetChanges() {
                pendingChanges = [];
                undoStack = [];
                updateButtonState();
                undoBtn.disabled = true;
                const batch = currentSelection.batch;
                const term = currentSelection.term;
                const section = currentSelection.section;
            }

            // Add this function
            function resetFilters() {
                professorFilter.value = 'all';
                courseFilter.value = 'all';
                applyInlineFilters();
                showMessage('Filters reset to show all', 'info');
            }

            function updateButtonState() {
                const numChanges = pendingChanges.length;
                saveBtn.disabled = numChanges === 0;
                saveBtn.textContent = `Save Changes (${numChanges})`;
                undoBtn.disabled = pendingChanges.length === 0;
                resetBtn.disabled = sectionScheduleData.length === 0;
                addClassBtn.disabled = sectionScheduleData.length === 0;
                editCourseBtn.disabled = sectionScheduleData.length === 0;
            }

            // --- Initialization ---
            function smoothScroll() {
                if (scrollSpeed !== 0) {
                    tableContainer.scrollTop += scrollSpeed;
                }
                requestAnimationFrame(smoothScroll);
            }

            // Initialize the application
            initApp();
            smoothScroll();
            initDragDrop();
            
            // Event Listeners
            batchSelect.addEventListener('change', handleSelectionChange);
            termSelect.addEventListener('change', handleSelectionChange);
            sectionSelect.addEventListener('change', handleSelectionChange);
            professorFilter.addEventListener('change', applyInlineFilters);
            courseFilter.addEventListener('change', applyInlineFilters);
            saveBtn.addEventListener('click', saveChanges);
            resetBtn.addEventListener('click', resetSchedule);
            undoBtn.addEventListener('click', undoLastChange);
            addClassBtn.addEventListener('click', showAddClassModal);
            editCourseBtn.addEventListener('click', showEditCourseModal);
            // Add this event listener in the initialization section (where other event listeners are)
            updateCourseBtn.addEventListener('click', handleUpdateCourse);

            // Add this with other event listeners
            if (showAllBtn) {
                
                showAllBtn.addEventListener('click', function() {
            
                    // Reset filters
                    professorFilter.value = 'all';
                    courseFilter.value = 'all';
                    
                    applyInlineFilters();
                    showMessage('Filters reset to show all', 'info');
                });
            } else {
                
                // Try to find it by other means
                const allButtons = document.querySelectorAll('button');

                allButtons.forEach(btn => {
                    if (btn.textContent.includes('Show All') || btn.id.includes('show-all')) {
                    }
                });
            }
            
            
            // Modal event listeners
            document.querySelectorAll('.close-modal').forEach(btn => {
                btn.addEventListener('click', () => {
                    hideAddClassModal();
                    hideEditCourseModal();
                });
            });
            
            document.querySelectorAll('.cancel-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    hideAddClassModal();
                    hideEditCourseModal();
                });
            });
            
            addClassForm.addEventListener('submit', handleAddClassSubmit);
            updateCourseBtn.addEventListener('click', handleUpdateCourse);
            
            window.addEventListener('resize', () => {
                tableContainerRect = tableContainer.getBoundingClientRect();
            });

        });