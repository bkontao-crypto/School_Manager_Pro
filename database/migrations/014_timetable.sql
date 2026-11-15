-- 014 : emploi du temps.
-- Un créneau = une classe, une matière, un jour (1 = lundi … 7 = dimanche), une plage horaire, un enseignant et une salle facultatifs.
-- Clés composites (tenant_id, id) : un créneau ne peut référencer que la classe et l'enseignant de son propre établissement.
-- Les chevauchements (même classe ou même enseignant au même moment) sont refusés par l'API.

CREATE TABLE IF NOT EXISTS timetable_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  class_id     UUID NOT NULL,
  teacher_id   UUID,
  subject      VARCHAR(100) NOT NULL,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  room         VARCHAR(50),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT timetable_slots_time_check CHECK (end_time > start_time),
  CONSTRAINT timetable_slots_class_fkey FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT timetable_slots_teacher_fkey FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_timetable_class_day ON timetable_slots (tenant_id, class_id, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher_day ON timetable_slots (tenant_id, teacher_id, day_of_week, start_time);
