-- Migration 012 : dossier individuel et affectation courante des élèves
-- Compatible avec les tables créées par les migrations 002, 003, 005 et 006.
ALTER TABLE students ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_student_parents_student ON student_parents(student_id);
