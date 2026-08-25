// ─── Static dummy data — replace with DB later ────────────────────────────────

const COLLEGES = ['COE', 'IOIT'];

const YEARS = ['1st', '2nd', '3rd', '4th'];

const DEPARTMENTS = ['Computer', 'IT', 'Electrical', 'E&TC', 'AIOS', 'Instrumentation'];

// College-specific parts (remaining parts)
const COLLEGE_PARTS = {
  'COE': ['Part 1', 'Part 2', 'Part 3', 'Part 4'],
  'IOIT': ['Part 1', 'Part 2', 'Part 3'],
};

// Subjects per year+department (dummy)
const SUBJECTS = {
  '2nd': {
    Computer:       ['Data Structures', 'Digital Electronics', 'Discrete Maths', 'OOP with Java'],
    IT:             ['Data Structures', 'Computer Networks Basics', 'Web Technology', 'OOP with Java'],
    Electrical:     ['Electrical Machines', 'Circuit Theory', 'Signals & Systems', 'Power Electronics'],
    'E&TC':         ['Analog Electronics', 'Signals & Systems', 'Digital Circuits', 'EM Theory'],
    AIOS:           ['Sensors & Transducers', 'Control Systems', 'Analog Electronics', 'Microcontrollers'],
    Instrumentation:['Measurement Systems', 'Control Systems', 'Analog Electronics', 'Transducers'],
  },
  '3rd': {
    Computer:       ['DBMS', 'Operating Systems', 'Computer Networks', 'Theory of Computation'],
    IT:             ['DBMS', 'Operating Systems', 'Software Engineering', 'Computer Networks'],
    Electrical:     ['Power Systems', 'Control Systems', 'Electrical Drives', 'Microprocessors'],
    'E&TC':         ['VLSI Design', 'Microprocessors', 'Communication Systems', 'DSP'],
    AIOS:           ['Industrial Automation', 'PLC & SCADA', 'Process Control', 'Robotics'],
    Instrumentation:['Industrial Instrumentation', 'Process Control', 'PLC & SCADA', 'Biomedical Instrumentation'],
  },
  '4th': {
    Computer:       ['Machine Learning', 'Cloud Computing', 'Compiler Design', 'Information Security'],
    IT:             ['Machine Learning', 'Cloud Computing', 'Big Data', 'Information Security'],
    Electrical:     ['Power Electronics', 'Renewable Energy', 'Smart Grid', 'High Voltage Engg'],
    'E&TC':         ['Wireless Communication', 'Embedded Systems', 'Image Processing', 'IoT'],
    AIOS:           ['Advanced Robotics', 'Machine Vision', 'IoT Systems', 'AI in Automation'],
    Instrumentation:['Smart Sensors', 'Wireless Instrumentation', 'IoT Systems', 'Advanced Control'],
  },
};

// Notes per subject (dummy)
const NOTES_BY_SUBJECT = (subject) => [
  { id: `${subject}-1`, title: `${subject} — Unit 1 Notes`, description: 'Complete unit 1 handwritten notes with diagrams.', price: 30 },
  { id: `${subject}-2`, title: `${subject} — Unit 2 Notes`, description: 'Unit 2 theory + solved examples.', price: 30 },
  { id: `${subject}-3`, title: `${subject} — Previous Year Questions`, description: 'Last 5 years question papers with solutions.', price: 20 },
  { id: `${subject}-4`, title: `${subject} — Full Syllabus Kit`, description: 'All units bundled — best value.', price: 80 },
];

// 1st year common kit
const FIRST_YEAR_KIT = {
  title:       'First Year Common Kit',
  description: 'Complete notes bundle for all 1st year subjects — Engineering Maths, Physics, Chemistry, Basic Electronics, Engineering Drawing.',
  price:       199,
  notes: [
    { id: 'fy-1', title: 'Engineering Mathematics I', description: 'Full notes with solved problems.', price: 40 },
    { id: 'fy-2', title: 'Engineering Physics',       description: 'Theory + lab manual.',            price: 35 },
    { id: 'fy-3', title: 'Engineering Chemistry',     description: 'Theory + lab manual.',            price: 35 },
    { id: 'fy-4', title: 'Basic Electronics',         description: 'Circuits, components, theory.',   price: 40 },
    { id: 'fy-5', title: 'Engineering Drawing',       description: 'Projection, CAD basics.',         price: 49 },
  ],
};

module.exports = { COLLEGES, YEARS, DEPARTMENTS, COLLEGE_PARTS, SUBJECTS, NOTES_BY_SUBJECT, FIRST_YEAR_KIT };
