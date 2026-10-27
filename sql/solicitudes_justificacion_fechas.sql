-- Solicitudes de justificación: rango pedido (fecha_inicio / fecha_fin) y cantidad de días.
-- dias_solicitados (varchar) pasa a ser cantidad_dias (int); ruta_documento pasa a ser documento;
-- fecha_inicio_pendiente ya no se usa.
-- (En producción ya está aplicado; esto es para dejar igual las bases locales.)
ALTER TABLE dbasistencia.solicitudes_justificacion
  CHANGE dias_solicitados cantidad_dias INT NULL,
  CHANGE ruta_documento documento VARCHAR(255) NULL,
  ADD COLUMN fecha_fin DATE NULL AFTER fecha_inicio,
  DROP COLUMN fecha_inicio_pendiente;
