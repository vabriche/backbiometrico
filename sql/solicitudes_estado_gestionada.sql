-- Solicitudes de justificación: estados G = Gestionada y D = Gestión parcial.
-- Circuito: P (pendiente) -> A (aceptada) -> G (RRHH cargó la inasistencia o la licencia).
-- Una inasistencia se gestiona a partir del día siguiente a su inicio. Si todavía no terminó, o su
-- motivo exige documento probatorio y el agente no lo subió, se gestiona en parte: A -> D (la
-- inasistencia queda cargada con estado 'P', pendiente) y, cuando terminó y está el documento,
-- D -> G (la inasistencia pasa a 'A').
-- Desde P o A también puede pasar a R (rechazada) o C (cancelada).
-- Se puede volver a correr.
ALTER TABLE solicitudes_justificacion
  DROP CONSTRAINT IF EXISTS solicitudes_justificacion_estado_CK,
  MODIFY COLUMN estado CHAR(1) NOT NULL DEFAULT 'P'
    COMMENT 'P=Pendiente, A=Aceptado, R=Rechazado, C=Cancelado, G=Gestionada (RRHH cargó la inasistencia o licencia), D=Gestión parcial (inasistencia cargada pendiente: en curso o sin el documento probatorio)',
  ADD COLUMN IF NOT EXISTS id_ina INT NULL
    COMMENT 'Inasistencia cargada por la gestión de RRHH (inasist.id_ina)',
  ADD CONSTRAINT solicitudes_justificacion_estado_CK CHECK (estado IN ('P','A','R','C','G','D'));

-- Con el circuito anterior, gestionar dejaba la solicitud en 'A'. Las que ya tienen cargada su
-- inasistencia o licencia (la gestión usa como nro. de resolución SOL-<id>) pasan a 'G', para que
-- no aparezcan como pendientes de gestionar ni se carguen dos veces.
UPDATE solicitudes_justificacion sj
   SET sj.estado = 'G'
 WHERE sj.estado = 'A'
   AND (EXISTS (SELECT 1 FROM inasist i WHERE i.nleg = sj.legajo AND i.nres = CONCAT('SOL-', sj.id))
        OR EXISTS (SELECT 1 FROM licencia l WHERE l.nleg = sj.legajo AND l.nres = CONCAT('SOL-', sj.id)));

-- Aceptadas que quedan por gestionar (revisar: si alguna ya se cargó con otra resolución,
-- marcarla a mano como 'G' en lugar de gestionarla de nuevo)
SELECT sj.id, sj.legajo, sj.tipo, sj.codina, sj.fecha_inicio, sj.fecha_fin
  FROM solicitudes_justificacion sj
 WHERE sj.estado = 'A';
