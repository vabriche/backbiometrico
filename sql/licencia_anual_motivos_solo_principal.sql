-- Saldo y compensación: se pueden tomar cualquier día y fraccionados.
-- Las advertencias INICIO_NO_HABIL, INICIO_ANTES_VENTANA, REINTEGRO_POSTERIOR y PARCIAL
-- pasan a aplicarse solo al tramo principal, y ninguna advertencia exige observación ni
-- impide grabar (solo se controla la cantidad de días contra el saldo).
-- Quita la restricción chk_tramo_obs y recrea sp_simular_tramo y sp_registrar_tramo (no toca datos).
-- Ejecutar: mysql -u USUARIO -p BASE < sql/licencia_anual_motivos_solo_principal.sql

-- La tabla tenía además una restricción CHECK que exigía observación en los tramos fuera de norma
ALTER TABLE reg_licencia_anual_rrhh DROP CONSTRAINT IF EXISTS chk_tramo_obs;

DELIMITER //

-- Simula un tramo sin guardarlo: devuelve reintegro, saldo y advertencias.
CREATE OR REPLACE PROCEDURE sp_simular_tramo(
  IN  p_legajo INT, IN p_periodo SMALLINT, IN p_tipo VARCHAR(20),
  IN  p_inicio DATE, IN p_dias SMALLINT,
  OUT p_reintegro DATE, OUT p_saldo_actual SMALLINT,
  OUT p_motivos VARCHAR(255), OUT p_error VARCHAR(255))
proc: BEGIN
  DECLARE v_derecho INT UNSIGNED;
  DECLARE v_corr SMALLINT;
  DECLARE v_ventana, v_reint_gral, v_venc DATE;
  DECLARE v_solapa INT DEFAULT 0;

  SET p_error = NULL, p_motivos = NULL, p_reintegro = NULL, p_saldo_actual = NULL;

  SELECT d.id, d.dias_corresponden, p.ventana_desde, p.reintegro_general, p.vencimiento
    INTO v_derecho, v_corr, v_ventana, v_reint_gral, v_venc
    FROM licencia_anual_derecho d
    JOIN periodo_vacaciones p ON p.periodo = d.periodo
   WHERE d.legajo = p_legajo AND d.periodo = p_periodo;

  IF v_derecho IS NULL THEN
    SET p_error = 'No hay derecho generado para ese legajo y periodo'; LEAVE proc;
  END IF;
  IF p_inicio IS NULL THEN
    SET p_error = 'Falta la fecha de inicio'; LEAVE proc;
  END IF;
  -- Límite duro contra fechas mal tipeadas (p. ej. año 0207): desde el 1/1 del periodo hasta
  -- un año después del vencimiento. Dentro de ese rango, lo fuera de norma va con autorización.
  IF p_inicio < MAKEDATE(p_periodo, 1) OR p_inicio > v_venc + INTERVAL 1 YEAR THEN
    SET p_error = CONCAT('La fecha de inicio está fuera del rango posible para el periodo ', p_periodo,
                         ' (', DATE_FORMAT(MAKEDATE(p_periodo, 1), '%d/%m/%Y'), ' a ',
                         DATE_FORMAT(v_venc + INTERVAL 1 YEAR, '%d/%m/%Y'), ')');
    LEAVE proc;
  END IF;
  IF p_dias IS NULL OR p_dias <= 0 THEN
    SET p_error = 'La cantidad de días debe ser mayor a cero'; LEAVE proc;
  END IF;

  SET p_saldo_actual = fn_saldo_tipo(v_derecho, p_tipo);
  SET p_reintegro    = fn_calcular_reintegro(p_inicio, p_dias);

  IF p_tipo = 'compensacion' AND p_saldo_actual = 0 THEN
    SET p_error = 'No tiene días devueltos por interrupción para compensar'; LEAVE proc;
  END IF;
  IF p_dias > p_saldo_actual THEN
    SET p_error = IF(p_tipo = 'compensacion',
      CONCAT('La compensación no puede superar los días devueltos por interrupción (', p_saldo_actual, ' días)'),
      IF(fn_dias_compensables(v_derecho) > 0,
         CONCAT('Excede el saldo disponible (', p_saldo_actual, ' días). Los ',
                fn_dias_compensables(v_derecho), ' días devueltos por interrupción se piden como compensación'),
         CONCAT('Excede el saldo disponible (', p_saldo_actual, ' días)')));
    LEAVE proc;
  END IF;

  SELECT COUNT(*) INTO v_solapa
    FROM reg_licencia_anual_rrhh t
    JOIN licencia_anual_derecho d ON d.id = t.derecho_id
   WHERE d.legajo = p_legajo
     AND t.estado IN ('pedido','aprobado','gozado')
     AND t.fecha_inicio < p_reintegro AND p_inicio < t.fecha_reintegro;
  IF v_solapa > 0 THEN
    SET p_error = 'Se superpone con otro tramo de licencia'; LEAVE proc;
  END IF;

  -- Advertencias (no impiden el pedido; requieren observación y autorización)
  IF p_inicio > v_venc THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'POST_VENCIMIENTO');
  END IF;
  -- Día hábil, ventana, reintegro general y días completos son reglas del tramo principal:
  -- el saldo se puede tomar cualquier día y fraccionado
  IF p_tipo = 'principal' THEN
    IF NOT fn_es_habil(p_inicio) THEN
      SET p_motivos = CONCAT_WS(',', p_motivos, 'INICIO_NO_HABIL');
    END IF;
    IF p_inicio < v_ventana THEN
      SET p_motivos = CONCAT_WS(',', p_motivos, 'INICIO_ANTES_VENTANA');
    END IF;
    IF p_reintegro > v_reint_gral THEN
      SET p_motivos = CONCAT_WS(',', p_motivos, 'REINTEGRO_POSTERIOR');
    END IF;
    IF p_dias < v_corr THEN
      SET p_motivos = CONCAT_WS(',', p_motivos, 'PARCIAL');
    END IF;
  END IF;
  -- La compensación y el resto que se pide después de una siempre se autorizan
  IF p_tipo = 'compensacion' THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'COMPENSACION');
  ELSEIF p_tipo = 'saldo' AND EXISTS (SELECT 1 FROM reg_licencia_anual_rrhh t
                                       WHERE t.derecho_id = v_derecho AND t.tipo = 'compensacion'
                                         AND t.estado IN ('pedido','aprobado','gozado')) THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'POST_COMPENSACION');
  END IF;
END//


-- Registra un tramo. Si no tiene advertencias queda 'aprobado';
-- si tiene, queda 'pedido' hasta que se autorice (sp_autorizar_tramo).
-- Llamar dentro de una transacción: bloquea los derechos de la persona para que dos
-- pedidos simultáneos no se pasen del saldo ni se superpongan.
CREATE OR REPLACE PROCEDURE sp_registrar_tramo(
  IN  p_legajo INT, IN p_periodo SMALLINT, IN p_tipo VARCHAR(20),
  IN  p_inicio DATE, IN p_dias SMALLINT, IN p_observacion VARCHAR(255),
  OUT p_tramo_id INT UNSIGNED, OUT p_reintegro DATE,
  OUT p_estado VARCHAR(20), OUT p_motivos VARCHAR(255))
BEGIN
  DECLARE v_saldo SMALLINT;
  DECLARE v_error VARCHAR(255);
  DECLARE v_derecho INT UNSIGNED;
  DECLARE v_bloqueados INT;

  IF p_tipo IS NULL OR p_tipo NOT IN ('principal','saldo','compensacion') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tipo de tramo inválido';
  END IF;

  SELECT COUNT(*) INTO v_bloqueados FROM licencia_anual_derecho WHERE legajo = p_legajo FOR UPDATE;

  CALL sp_simular_tramo(p_legajo, p_periodo, p_tipo, p_inicio, p_dias,
                        p_reintegro, v_saldo, p_motivos, v_error);
  IF v_error IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_error;
  END IF;
  -- Las advertencias (p_motivos) no impiden el pedido ni exigen observación: quedan
  -- registradas en fuera_de_norma / motivos_norma para que las vea quien autoriza.

  SELECT id INTO v_derecho FROM licencia_anual_derecho
   WHERE legajo = p_legajo AND periodo = p_periodo;

  -- Todo tramo nace como pedido (aun el principal y dentro de norma): lo aprueba RRHH con sp_autorizar_tramo.
  SET p_estado = 'pedido';

  INSERT INTO reg_licencia_anual_rrhh
    (derecho_id, tipo, fecha_inicio, dias_computados, fecha_reintegro, estado,
     fuera_de_norma, motivos_norma, observacion, creado_por, modificado_por)
  VALUES
    (v_derecho, p_tipo, p_inicio, p_dias, p_reintegro, p_estado,
     p_motivos IS NOT NULL, p_motivos, NULLIF(TRIM(p_observacion), ''), @app_usuario, @app_usuario);

  SET p_tramo_id = LAST_INSERT_ID();
END//

DELIMITER ;
