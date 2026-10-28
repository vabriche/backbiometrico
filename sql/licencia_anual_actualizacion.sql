-- =====================================================================
--  LICENCIA ANUAL ORDINARIA (VACACIONES) - ACTUALIZACIÓN DE PRODUCCIÓN
--  Base: dbasistencia. Requiere MariaDB 10.5 o superior.
--
--  Para la base de producción, que ya tiene las tablas de licencia anual de la versión anterior
--  (licencia_anual_derecho, reg_licencia_anual_rrhh, etc.) pero no las funciones ni los
--  procedimientos nuevos.
--
--  Qué hace, en orden:
--   1. vacaciones_rrhh pasa a (legajo, fecha_ingreso, fecha_reconocimiento, anios, meses, dias,
--      activo). Solo si todavía tiene la estructura vieja (reconocimiento_meses / observacion).
--   2. Crea o reemplaza todas las funciones (fn_*)
--   3. Crea o reemplaza todos los procedimientos (sp_*). Entre otros cambios, todo tramo nuevo
--      queda en estado 'pedido' hasta que RRHH lo autoriza.
--   4. Recrea las vistas (quedan con el usuario que corre el script como definer)
--   5. Controles
--  No toca datos de derechos, tramos ni interrupciones. Se puede volver a correr.
--  Las reglas de negocio de vacaciones viven en las secciones 2 a 4: si se cambia una función,
--  procedimiento o vista, cambiarla acá.
--
--  Cómo correrlo:
--   1. Hacer un backup completo de la base (con --routines).
--   2. mysql -h <servidor> -u <usuario> -p dbasistencia < licencia_anual_actualizacion.sql
--   3. Revisar los controles del final.
--   4. Publicar el backend y el frontend nuevos.
--   5. Pantalla Licencias anuales > Personal: "Generar personal" para cargar ingreso (datos_rrhh)
--      y reconocimiento (antiguedad_rrhh), revisar activos, y después generar los derechos 2026.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. VERIFICACIÓN
-- ---------------------------------------------------------------------
DELIMITER //
CREATE OR REPLACE PROCEDURE tmp_verificar_actualizacion()
BEGIN
  IF CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) * 100
     + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED) < 1005 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Se necesita MariaDB 10.5 o superior: no se hizo ningún cambio';
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('vacaciones_rrhh', 'licencia_anual_derecho', 'reg_licencia_anual_rrhh',
                            'licencia_interrupcion', 'periodo_vacaciones', 'escala_vacaciones', 'feriados')) < 7 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La base no tiene las tablas de licencia anual: no se hizo ningún cambio';
  END IF;
END//
DELIMITER ;
CALL tmp_verificar_actualizacion();
DROP PROCEDURE tmp_verificar_actualizacion;

-- ---------------------------------------------------------------------
-- 1. PERSONAL: ESTRUCTURA NUEVA DE vacaciones_rrhh
-- ---------------------------------------------------------------------
-- Ingreso a la FCE (datos_rrhh.fifce) y reconocimiento de otros empleos como duración
-- (anios, meses, dias) que termina en fecha_reconocimiento (antiguedad_rrhh).
-- Se conservan legajo, fecha_ingreso y activo; el reconocimiento se vuelve a cargar con
-- "Generar personal".
DELIMITER //
CREATE OR REPLACE PROCEDURE tmp_actualizar_personal()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vacaciones_rrhh'
                AND COLUMN_NAME = 'reconocimiento_meses') THEN
    ALTER TABLE vacaciones_rrhh
      DROP COLUMN reconocimiento_meses,
      DROP COLUMN observacion,
      ADD COLUMN fecha_reconocimiento DATE DEFAULT NULL AFTER fecha_ingreso,
      ADD COLUMN anios SMALLINT(5) UNSIGNED DEFAULT 0 AFTER fecha_reconocimiento,
      ADD COLUMN meses SMALLINT(5) UNSIGNED DEFAULT 0 AFTER anios,
      ADD COLUMN dias  SMALLINT(5) UNSIGNED DEFAULT 0 AFTER meses,
      MODIFY COLUMN activo TINYINT(1) DEFAULT NULL;
  END IF;
END//
DELIMITER ;
CALL tmp_actualizar_personal();
DROP PROCEDURE tmp_actualizar_personal;

-- Función de una versión intermedia que ya no se usa
DROP FUNCTION IF EXISTS fn_inicio_antiguedad;

-- ---------------------------------------------------------------------
-- 2. FUNCIONES
-- ---------------------------------------------------------------------
DELIMITER //

-- ¿Es día laborable? Lunes a viernes y no feriado.
CREATE OR REPLACE FUNCTION fn_es_habil(p_fecha DATE)
RETURNS TINYINT(1) NOT DETERMINISTIC READS SQL DATA
BEGIN
  RETURN DAYOFWEEK(p_fecha) NOT IN (1,7)
         AND NOT EXISTS (SELECT 1 FROM feriados WHERE fecha = p_fecha);
END//

-- Fecha de reintegro: el día siguiente al último día computado;
-- si cae sábado, domingo o feriado, pasa al siguiente día hábil.
CREATE OR REPLACE FUNCTION fn_calcular_reintegro(p_inicio DATE, p_dias SMALLINT)
RETURNS DATE NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE r DATE DEFAULT DATE_ADD(p_inicio, INTERVAL p_dias DAY);
  WHILE NOT fn_es_habil(r) DO
    SET r = DATE_ADD(r, INTERVAL 1 DAY);
  END WHILE;
  RETURN r;
END//

-- Días a computar cuando se carga el día de reintegro en lugar de los días.
-- Varias cantidades dan el mismo reintegro (las que terminan antes de un fin de semana
-- o feriado): se elige la mayor que no supera p_maximo (el saldo). Si ni la menor entra,
-- devuelve la menor, para que la simulación informe que excede el saldo.
-- NULL si el reintegro no es posterior al inicio o no es día hábil.
CREATE OR REPLACE FUNCTION fn_dias_por_reintegro(p_inicio DATE, p_reintegro DATE, p_maximo SMALLINT)
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE d INT DEFAULT DATEDIFF(p_reintegro, p_inicio);
  IF d <= 0 OR NOT fn_es_habil(p_reintegro) THEN
    RETURN NULL;
  END IF;
  -- Bajar un día es posible mientras el día que se deja de computar no sea hábil
  WHILE d > 1 AND d > IFNULL(p_maximo, 0)
        AND NOT fn_es_habil(DATE_ADD(p_inicio, INTERVAL d - 1 DAY)) DO
    SET d = d - 1;
  END WHILE;
  RETURN d;
END//

-- Primer día hábil igual o posterior a una fecha (para sugerir inicio).
CREATE OR REPLACE FUNCTION fn_proximo_habil(p_fecha DATE)
RETURNS DATE NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE r DATE DEFAULT p_fecha;
  WHILE NOT fn_es_habil(r) DO
    SET r = DATE_ADD(r, INTERVAL 1 DAY);
  END WHILE;
  RETURN r;
END//

-- Antigüedad a una fecha de corte, en días de "meses de 30 y años de 12 meses"
-- (años = valor DIV 360, meses = valor MOD 360 DIV 30, días = valor MOD 30).
-- Sin reconocimiento: el lapso desde la fecha de ingreso hasta el corte.
-- Con reconocimiento: lo reconocido (anios, meses, dias) más el lapso desde
-- fecha_reconocimiento hasta el corte (si no tiene fecha, desde el ingreso).
-- Las sumas pasan los días a meses cada 30 y los meses a años cada 12.
-- NULL si el legajo no está en vacaciones_rrhh.
CREATE OR REPLACE FUNCTION fn_antiguedad_dias(p_legajo INT, p_corte DATE)
RETURNS INT NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE v_ingreso, v_fecha_rec, v_desde DATE;
  DECLARE v_anios, v_meses, v_dias, v_lapso_meses INT;
  SELECT fecha_ingreso, fecha_reconocimiento, IFNULL(anios, 0), IFNULL(meses, 0), IFNULL(dias, 0)
    INTO v_ingreso, v_fecha_rec, v_anios, v_meses, v_dias
    FROM vacaciones_rrhh WHERE legajo = p_legajo;
  IF v_ingreso IS NULL THEN
    RETURN NULL;
  END IF;
  SET v_desde = IF(v_anios + v_meses + v_dias = 0, v_ingreso, IFNULL(v_fecha_rec, v_ingreso));
  IF v_desde > p_corte THEN
    SET v_desde = p_corte;
  END IF;
  SET v_lapso_meses = TIMESTAMPDIFF(MONTH, v_desde, p_corte);
  RETURN (v_anios * 12 + v_meses + v_lapso_meses) * 30 + v_dias
         + DATEDIFF(p_corte, v_desde + INTERVAL v_lapso_meses MONTH);
END//

-- Antigüedad en meses cumplidos a una fecha de corte (la que usa la escala).
CREATE OR REPLACE FUNCTION fn_antiguedad_meses(p_legajo INT, p_corte DATE)
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  RETURN IFNULL(fn_antiguedad_dias(p_legajo, p_corte) DIV 30, 0);
END//

-- Días según escala para una antigüedad en meses.
CREATE OR REPLACE FUNCTION fn_dias_por_antiguedad(p_meses SMALLINT)
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE v_dias SMALLINT;
  SELECT dias INTO v_dias FROM escala_vacaciones
   WHERE FLOOR(p_meses / 12) >= anios_desde AND FLOOR(p_meses / 12) < anios_hasta
   LIMIT 1;
  RETURN v_dias;
END//

-- Días devueltos por un tramo (interrupciones validadas).
CREATE OR REPLACE FUNCTION fn_dias_devueltos_tramo(p_tramo_id INT UNSIGNED)
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  RETURN (SELECT IFNULL(SUM(dias), 0) FROM licencia_interrupcion
           WHERE tramo_id = p_tramo_id AND estado = 'validada');
END//

-- Saldo de un derecho. Los pedidos pendientes ya reservan días,
-- para que nadie pueda pedir dos veces el mismo saldo.
CREATE OR REPLACE FUNCTION fn_saldo(p_derecho_id INT UNSIGNED)
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE v_corr, v_usados, v_devueltos INT DEFAULT 0;
  SELECT dias_corresponden INTO v_corr FROM licencia_anual_derecho WHERE id = p_derecho_id;
  SELECT IFNULL(SUM(dias_computados), 0) INTO v_usados
    FROM reg_licencia_anual_rrhh
   WHERE derecho_id = p_derecho_id AND estado IN ('pedido','aprobado','gozado');
  SELECT IFNULL(SUM(i.dias), 0) INTO v_devueltos
    FROM licencia_interrupcion i
    JOIN reg_licencia_anual_rrhh t ON t.id = i.tramo_id
   WHERE t.derecho_id = p_derecho_id AND i.estado = 'validada'
     AND t.estado IN ('aprobado','gozado');
  RETURN v_corr - v_usados + v_devueltos;
END//

-- Días devueltos por interrupciones que todavía no se pidieron como compensación.
-- Esos días solo se toman con un tramo 'compensacion', nunca como 'saldo'.
CREATE OR REPLACE FUNCTION fn_dias_compensables(p_derecho_id INT UNSIGNED)
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE v_devueltos, v_compensados INT DEFAULT 0;
  SELECT IFNULL(SUM(i.dias), 0) INTO v_devueltos
    FROM licencia_interrupcion i
    JOIN reg_licencia_anual_rrhh t ON t.id = i.tramo_id
   WHERE t.derecho_id = p_derecho_id AND i.estado = 'validada'
     AND t.estado IN ('aprobado','gozado');
  SELECT IFNULL(SUM(dias_computados), 0) INTO v_compensados
    FROM reg_licencia_anual_rrhh
   WHERE derecho_id = p_derecho_id AND tipo = 'compensacion'
     AND estado IN ('pedido','aprobado','gozado');
  RETURN GREATEST(v_devueltos - v_compensados, 0);
END//

-- Saldo que puede usar un tramo según su tipo: la compensación solo los días
-- devueltos por interrupción; el resto de los tipos, el saldo sin esos días.
CREATE OR REPLACE FUNCTION fn_saldo_tipo(p_derecho_id INT UNSIGNED, p_tipo VARCHAR(20))
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE v_saldo SMALLINT DEFAULT fn_saldo(p_derecho_id);
  DECLARE v_comp SMALLINT DEFAULT fn_dias_compensables(p_derecho_id);
  IF p_tipo = 'compensacion' THEN
    RETURN LEAST(v_saldo, v_comp);
  END IF;
  RETURN GREATEST(v_saldo - v_comp, 0);
END//

-- Periodo sugerido para un nuevo pedido: el más antiguo con saldo (primero lo viejo).
CREATE OR REPLACE FUNCTION fn_periodo_sugerido(p_legajo INT)
RETURNS SMALLINT NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE v_periodo SMALLINT;
  SELECT periodo INTO v_periodo FROM licencia_anual_derecho
   WHERE legajo = p_legajo AND fn_saldo(id) > 0
   ORDER BY periodo LIMIT 1;
  RETURN v_periodo;
END//

DELIMITER ;

-- ---------------------------------------------------------------------
-- 3. PROCEDIMIENTOS
-- ---------------------------------------------------------------------
DELIMITER //

-- Crea el periodo con sus fechas por defecto (si no existe).
-- Ventana desde el 21/12, reintegro el primer lunes de febrero,
-- límite de pedido 01/12, vencimiento 30/11 del año siguiente.
CREATE OR REPLACE PROCEDURE sp_crear_periodo(IN p_periodo SMALLINT)
BEGIN
  DECLARE v_feb DATE DEFAULT MAKEDATE(p_periodo + 1, 32);  -- 1 de febrero
  DECLARE v_lunes DATE;
  SET v_lunes = DATE_ADD(v_feb, INTERVAL MOD(9 - DAYOFWEEK(v_feb), 7) DAY);
  INSERT IGNORE INTO periodo_vacaciones
    (periodo, fecha_corte, ventana_desde, reintegro_general, fecha_limite_pedido, vencimiento)
  VALUES
    (p_periodo,
     MAKEDATE(p_periodo, 1) + INTERVAL 11 MONTH + INTERVAL 30 DAY,  -- 31/12
     MAKEDATE(p_periodo, 1) + INTERVAL 11 MONTH + INTERVAL 20 DAY,  -- 21/12
     v_lunes,
     MAKEDATE(p_periodo, 1) + INTERVAL 11 MONTH,                    -- 01/12
     MAKEDATE(p_periodo + 1, 1) + INTERVAL 10 MONTH + INTERVAL 29 DAY); -- 30/11 año sig.
END//

-- Genera el derecho del periodo para todo el personal activo (ejecutar el 1/11).
-- Es idempotente: no pisa derechos ya generados.
CREATE OR REPLACE PROCEDURE sp_generar_derechos(IN p_periodo SMALLINT, OUT p_generados INT)
BEGIN
  DECLARE v_corte DATE;
  CALL sp_crear_periodo(p_periodo);
  SELECT fecha_corte INTO v_corte FROM periodo_vacaciones WHERE periodo = p_periodo;

  INSERT INTO licencia_anual_derecho (legajo, periodo, antiguedad_meses, dias_corresponden, modificado_por)
  SELECT v.legajo, p_periodo,
         fn_antiguedad_meses(v.legajo, v_corte),
         fn_dias_por_antiguedad(fn_antiguedad_meses(v.legajo, v_corte)),
         @app_usuario
    FROM vacaciones_rrhh v
   WHERE v.activo = 1
     AND v.fecha_ingreso <= v_corte
     AND NOT EXISTS (SELECT 1 FROM licencia_anual_derecho d
                      WHERE d.legajo = v.legajo AND d.periodo = p_periodo);
  SET p_generados = ROW_COUNT();

  UPDATE periodo_vacaciones SET generado = NOW() WHERE periodo = p_periodo;
END//

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
  IF NOT fn_es_habil(p_inicio) THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'INICIO_NO_HABIL');
  END IF;
  IF p_inicio > v_venc THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'POST_VENCIMIENTO');
  END IF;
  IF p_inicio < v_ventana THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'INICIO_ANTES_VENTANA');
  END IF;
  IF p_reintegro > v_reint_gral THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'REINTEGRO_POSTERIOR');
  END IF;
  IF p_tipo = 'principal' AND p_dias < v_corr THEN
    SET p_motivos = CONCAT_WS(',', p_motivos, 'PARCIAL');
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

-- Convierte lo que cargó la persona (días, último día o día de reintegro: solo uno)
-- en días computados y simula el tramo. No guarda nada.
CREATE OR REPLACE PROCEDURE sp_preparar_pedido(
  IN  p_legajo INT, IN p_periodo SMALLINT, IN p_tipo VARCHAR(20), IN p_inicio DATE,
  IN  p_dias SMALLINT, IN p_ultimo DATE, IN p_reintegro DATE,
  OUT o_dias SMALLINT, OUT o_ultimo DATE, OUT o_reintegro DATE,
  OUT o_saldo SMALLINT, OUT o_motivos VARCHAR(255), OUT o_error VARCHAR(255))
proc: BEGIN
  DECLARE v_derecho INT UNSIGNED;
  DECLARE v_cargados TINYINT DEFAULT (p_dias IS NOT NULL) + (p_ultimo IS NOT NULL) + (p_reintegro IS NOT NULL);

  SET o_dias = NULL, o_ultimo = NULL, o_reintegro = NULL, o_saldo = NULL, o_motivos = NULL, o_error = NULL;

  IF p_inicio IS NULL THEN
    SET o_error = 'Falta la fecha de inicio'; LEAVE proc;
  END IF;
  IF v_cargados > 1 THEN
    SET o_error = 'Indicar solo uno: días, último día o fecha de reintegro'; LEAVE proc;
  END IF;
  IF v_cargados = 0 THEN
    SET o_error = 'Indicar los días, el último día o la fecha de reintegro'; LEAVE proc;
  END IF;

  IF p_dias IS NOT NULL THEN
    SET o_dias = p_dias;
  ELSEIF p_ultimo IS NOT NULL THEN
    IF p_ultimo < p_inicio THEN
      SET o_error = 'El último día no puede ser anterior al inicio'; LEAVE proc;
    END IF;
    SET o_dias = DATEDIFF(p_ultimo, p_inicio) + 1;
  ELSE
    IF p_reintegro <= p_inicio THEN
      SET o_error = 'El reintegro debe ser posterior al inicio'; LEAVE proc;
    END IF;
    IF NOT fn_es_habil(p_reintegro) THEN
      SET o_error = 'El reintegro debe ser un día hábil'; LEAVE proc;
    END IF;
    SELECT id INTO v_derecho FROM licencia_anual_derecho WHERE legajo = p_legajo AND periodo = p_periodo;
    IF v_derecho IS NULL THEN
      SET o_error = 'No hay derecho generado para ese legajo y periodo'; LEAVE proc;
    END IF;
    SET o_dias = fn_dias_por_reintegro(p_inicio, p_reintegro, fn_saldo_tipo(v_derecho, p_tipo));
    IF o_dias IS NULL THEN
      SET o_error = 'Con esa fecha de reintegro no se puede calcular la licencia'; LEAVE proc;
    END IF;
  END IF;

  IF o_dias > 0 THEN
    SET o_ultimo = DATE_ADD(p_inicio, INTERVAL o_dias - 1 DAY);
  END IF;
  CALL sp_simular_tramo(p_legajo, p_periodo, p_tipo, p_inicio, o_dias,
                        o_reintegro, o_saldo, o_motivos, o_error);
END//

-- Datos de la pantalla de pedido: un renglón por periodo con derecho. Marca el periodo
-- sugerido y, si el periodo no tiene tramo principal, propone fechas: reintegro el
-- reintegro general e inicio contando el saldo hacia atrás, sin empezar antes de la
-- ventana ni antes de hoy, y siempre en día hábil.
CREATE OR REPLACE PROCEDURE sp_datos_pedido(IN p_legajo INT)
BEGIN
  DECLARE v_sugerido SMALLINT DEFAULT fn_periodo_sugerido(p_legajo);
  SELECT x.*,
         IF(x.inicio_sugerido IS NULL, NULL,
            DATE_ADD(x.inicio_sugerido, INTERVAL x.saldo - 1 DAY))      AS ultimo_dia_sugerido,
         IF(x.inicio_sugerido IS NULL, NULL,
            fn_calcular_reintegro(x.inicio_sugerido, x.saldo))           AS reintegro_sugerido
    FROM (
      SELECT s.derecho_id, s.periodo, s.antiguedad_meses, s.antiguedad_anios,
             MOD(s.antiguedad_meses, 12) AS antiguedad_resto_meses,
             s.dias_corresponden, s.dias_aprobados, s.dias_pendientes_autoriz, s.dias_devueltos,
             s.saldo, s.vencimiento, s.estado_saldo,
             p.ventana_desde, p.reintegro_general, p.fecha_limite_pedido,
             (s.periodo <=> v_sugerido) AS sugerido,
             EXISTS (SELECT 1 FROM reg_licencia_anual_rrhh t
                      WHERE t.derecho_id = s.derecho_id AND t.tipo = 'principal'
                        AND t.estado IN ('pedido','aprobado','gozado')) AS tiene_principal,
             IF(s.saldo > 0 AND NOT EXISTS (SELECT 1 FROM reg_licencia_anual_rrhh t
                                             WHERE t.derecho_id = s.derecho_id AND t.tipo = 'principal'
                                               AND t.estado IN ('pedido','aprobado','gozado')),
                fn_proximo_habil(GREATEST(p.ventana_desde, DATE_SUB(p.reintegro_general, INTERVAL s.saldo DAY), CURDATE())),
                NULL) AS inicio_sugerido
        FROM v_saldo_vacaciones s
        JOIN periodo_vacaciones p ON p.periodo = s.periodo
       WHERE s.legajo = p_legajo
    ) x
   ORDER BY x.periodo;
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
  IF p_motivos IS NOT NULL AND (p_observacion IS NULL OR TRIM(p_observacion) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El tramo está fuera de norma: la observación es obligatoria';
  END IF;

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

-- Autoriza o rechaza un tramo pendiente.
CREATE OR REPLACE PROCEDURE sp_autorizar_tramo(
  IN p_tramo_id INT UNSIGNED, IN p_aprobar TINYINT, IN p_motivo VARCHAR(255))
BEGIN
  DECLARE v_estado VARCHAR(20);
  SELECT estado INTO v_estado FROM reg_licencia_anual_rrhh WHERE id = p_tramo_id FOR UPDATE;
  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tramo inexistente';
  END IF;
  IF v_estado <> 'pedido' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden autorizar tramos en estado pedido';
  END IF;
  IF @app_usuario IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falta @app_usuario (quién autoriza)';
  END IF;
  UPDATE reg_licencia_anual_rrhh
     SET estado = IF(p_aprobar, 'aprobado', 'rechazado'),
         autorizado_por = @app_usuario, fecha_autoriz = NOW(), motivo_autoriz = p_motivo,
         modificado_por = @app_usuario
   WHERE id = p_tramo_id;
END//

-- Cancela un tramo que todavía no empezó (los días vuelven al saldo).
CREATE OR REPLACE PROCEDURE sp_cancelar_tramo(IN p_tramo_id INT UNSIGNED, IN p_motivo VARCHAR(255))
BEGIN
  DECLARE v_estado VARCHAR(20);
  DECLARE v_inicio DATE;
  SELECT estado, fecha_inicio INTO v_estado, v_inicio
    FROM reg_licencia_anual_rrhh WHERE id = p_tramo_id FOR UPDATE;
  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tramo inexistente';
  END IF;
  IF v_estado NOT IN ('pedido','aprobado') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se cancelan tramos pedidos o aprobados';
  END IF;
  IF v_inicio <= CURDATE() THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El tramo ya empezó: registrar una interrupción en lugar de cancelar';
  END IF;
  IF EXISTS (SELECT 1 FROM licencia_interrupcion
              WHERE tramo_id = p_tramo_id AND estado <> 'rechazada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El tramo tiene interrupciones registradas';
  END IF;
  UPDATE reg_licencia_anual_rrhh
     SET estado = 'cancelado', motivo_autoriz = p_motivo, modificado_por = @app_usuario
   WHERE id = p_tramo_id;
END//

-- Registra una interrupción. Solo cuentan los días dentro del periodo computado
-- (no el fin de semana o feriado extra antes del reintegro).
CREATE OR REPLACE PROCEDURE sp_registrar_interrupcion(
  IN p_tramo_id INT UNSIGNED, IN p_desde DATE, IN p_hasta DATE,
  IN p_motivo VARCHAR(20), IN p_tipo_ref VARCHAR(20), IN p_nro_ref VARCHAR(50),
  IN p_observacion VARCHAR(255), OUT p_interr_id INT UNSIGNED, OUT p_dias SMALLINT)
BEGIN
  DECLARE v_estado VARCHAR(20);
  DECLARE v_inicio, v_fin DATE;
  DECLARE v_solapa INT DEFAULT 0;
  DECLARE v_desde, v_hasta DATE;

  SELECT estado, fecha_inicio, fecha_fin_computo INTO v_estado, v_inicio, v_fin
    FROM reg_licencia_anual_rrhh WHERE id = p_tramo_id FOR UPDATE;

  IF v_estado IS NULL OR v_estado NOT IN ('aprobado','gozado') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El tramo debe estar aprobado o gozado';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Rango de fechas inválido';
  END IF;

  SET v_desde = GREATEST(p_desde, v_inicio);
  SET v_hasta = LEAST(p_hasta, v_fin);
  IF v_hasta < v_desde THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las fechas no caen dentro de los días computados del tramo';
  END IF;

  SELECT COUNT(*) INTO v_solapa FROM licencia_interrupcion
   WHERE tramo_id = p_tramo_id AND estado <> 'rechazada'
     AND fecha_desde <= v_hasta AND v_desde <= fecha_hasta;
  IF v_solapa > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Se superpone con otra interrupción del mismo tramo';
  END IF;

  SET p_dias = DATEDIFF(v_hasta, v_desde) + 1;

  INSERT INTO licencia_interrupcion
    (tramo_id, fecha_desde, fecha_hasta, dias, motivo, tipo_referencia, nro_referencia,
     observacion, creado_por, modificado_por)
  VALUES
    (p_tramo_id, v_desde, v_hasta, p_dias, p_motivo, NULLIF(p_tipo_ref, ''), NULLIF(p_nro_ref, ''),
     NULLIF(TRIM(p_observacion), ''), @app_usuario, @app_usuario);
  SET p_interr_id = LAST_INSERT_ID();
END//

-- Valida o rechaza una interrupción. Solo las validadas devuelven días.
CREATE OR REPLACE PROCEDURE sp_validar_interrupcion(IN p_interr_id INT UNSIGNED, IN p_validar TINYINT)
BEGIN
  IF @app_usuario IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falta @app_usuario (quién valida)';
  END IF;
  UPDATE licencia_interrupcion
     SET estado = IF(p_validar, 'validada', 'rechazada'),
         validado_por = @app_usuario, fecha_validacion = NOW(), modificado_por = @app_usuario
   WHERE id = p_interr_id AND estado = 'pendiente';
  IF ROW_COUNT() = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Interrupción inexistente o ya procesada';
  END IF;
END//

-- Pasa a 'gozado' los tramos aprobados cuyo reintegro ya pasó. Lo corre el backend antes de
-- mostrar estados (el event_scheduler está apagado): modificado_por queda NULL (= sistema).
CREATE OR REPLACE PROCEDURE sp_cerrar_tramos_gozados(OUT p_cerrados INT)
BEGIN
  UPDATE reg_licencia_anual_rrhh
     SET estado = 'gozado', modificado_por = NULL
   WHERE estado = 'aprobado' AND fecha_reintegro <= CURDATE();
  SET p_cerrados = ROW_COUNT();
END//

DELIMITER ;

-- ---------------------------------------------------------------------
-- 4. VISTAS
-- ---------------------------------------------------------------------

-- Saldo por persona y periodo.
CREATE OR REPLACE VIEW v_saldo_vacaciones AS
SELECT d.id AS derecho_id, d.legajo, d.periodo,
       d.antiguedad_meses, FLOOR(d.antiguedad_meses / 12) AS antiguedad_anios,
       d.dias_corresponden, d.ajuste_motivo,
       CAST(IFNULL(u.gozados_aprob, 0) AS SIGNED) AS dias_aprobados,
       CAST(IFNULL(u.pendientes, 0) AS SIGNED)    AS dias_pendientes_autoriz,
       CAST(IFNULL(i.devueltos, 0) AS SIGNED)     AS dias_devueltos,
       CAST(d.dias_corresponden - IFNULL(u.gozados_aprob, 0) - IFNULL(u.pendientes, 0)
            + IFNULL(i.devueltos, 0) AS SIGNED)   AS saldo,
       p.vencimiento,
       CASE
         WHEN d.dias_corresponden - IFNULL(u.gozados_aprob, 0) - IFNULL(u.pendientes, 0)
              + IFNULL(i.devueltos, 0) <= 0 THEN 'completo'
         WHEN CURDATE() > p.vencimiento THEN 'vencido'
         ELSE 'vigente'
       END AS estado_saldo
  FROM licencia_anual_derecho d
  JOIN periodo_vacaciones p ON p.periodo = d.periodo
  LEFT JOIN (SELECT derecho_id,
                    SUM(IF(estado IN ('aprobado','gozado'), dias_computados, 0)) AS gozados_aprob,
                    SUM(IF(estado = 'pedido', dias_computados, 0))              AS pendientes
               FROM reg_licencia_anual_rrhh GROUP BY derecho_id) u ON u.derecho_id = d.id
  LEFT JOIN (SELECT t.derecho_id, SUM(i.dias) AS devueltos
               FROM licencia_interrupcion i
               JOIN reg_licencia_anual_rrhh t ON t.id = i.tramo_id
              WHERE i.estado = 'validada' AND t.estado IN ('aprobado','gozado')
              GROUP BY t.derecho_id) i ON i.derecho_id = d.id;

-- Personal sin pedido principal (control del 1/12).
CREATE OR REPLACE VIEW v_sin_pedido_principal AS
SELECT d.legajo, d.periodo, d.dias_corresponden, p.fecha_limite_pedido,
       (CURDATE() > p.fecha_limite_pedido) AS fuera_de_termino
  FROM licencia_anual_derecho d
  JOIN periodo_vacaciones p ON p.periodo = d.periodo
 WHERE NOT EXISTS (SELECT 1 FROM reg_licencia_anual_rrhh t
                    WHERE t.derecho_id = d.id AND t.tipo = 'principal'
                      AND t.estado IN ('pedido','aprobado','gozado'));

-- Tramos pendientes de autorización.
CREATE OR REPLACE VIEW v_tramos_pendientes AS
SELECT t.id AS tramo_id, d.legajo, d.periodo, t.tipo, t.fecha_inicio, t.dias_computados,
       t.fecha_reintegro, t.motivos_norma, t.observacion, t.creado
  FROM reg_licencia_anual_rrhh t
  JOIN licencia_anual_derecho d ON d.id = t.derecho_id
 WHERE t.estado = 'pedido';

-- Interrupciones pendientes de validar.
CREATE OR REPLACE VIEW v_interrupciones_pendientes AS
SELECT i.id AS interrupcion_id, d.legajo, d.periodo, i.tramo_id, i.motivo,
       i.fecha_desde, i.fecha_hasta, i.dias, i.tipo_referencia, i.nro_referencia,
       i.observacion, i.creado
  FROM licencia_interrupcion i
  JOIN reg_licencia_anual_rrhh t ON t.id = i.tramo_id
  JOIN licencia_anual_derecho d ON d.id = t.derecho_id
 WHERE i.estado = 'pendiente';

-- Historia completa de una persona, en orden cronológico.
CREATE OR REPLACE VIEW v_historia_licencias AS
SELECT d.legajo, d.periodo, d.generado AS fecha_evento, 'derecho' AS evento,
       CONCAT(d.dias_corresponden, ' días (antigüedad ', FLOOR(d.antiguedad_meses/12), ' años ',
              MOD(d.antiguedad_meses,12), ' meses)',
              IFNULL(CONCAT(' — ajuste: ', d.ajuste_motivo), '')) AS detalle,
       NULL AS estado, d.id AS ref_id
  FROM licencia_anual_derecho d
UNION ALL
SELECT d.legajo, d.periodo, t.fecha_inicio, CONCAT('tramo ', t.tipo),
       CONCAT(t.fecha_inicio, ' al ', t.fecha_fin_computo, ', ', t.dias_computados,
              ' días, reintegro ', t.fecha_reintegro,
              IF(t.fuera_de_norma, CONCAT(' [', t.motivos_norma, ']'), '')),
       t.estado, t.id
  FROM reg_licencia_anual_rrhh t
  JOIN licencia_anual_derecho d ON d.id = t.derecho_id
UNION ALL
SELECT d.legajo, d.periodo, i.fecha_desde, CONCAT('interrupción ', i.motivo),
       CONCAT(i.fecha_desde, ' al ', i.fecha_hasta, ', ', i.dias, ' días',
              IFNULL(CONCAT(', ', i.tipo_referencia, ' ', i.nro_referencia), '')),
       i.estado, i.id
  FROM licencia_interrupcion i
  JOIN reg_licencia_anual_rrhh t ON t.id = i.tramo_id
  JOIN licencia_anual_derecho d ON d.id = t.derecho_id;

-- Historial de cambios reconstruido desde las tablas versionadas.
-- Reemplaza a la antigua tabla licencia_historial: una fila por alta y por
-- cada cambio de estado, fechas o días. usuario = modificado_por de esa versión
-- (NULL = tarea programada o cambio hecho fuera de los procedimientos).
CREATE OR REPLACE VIEW v_historial_cambios AS
SELECT 'tramo' AS entidad, v.id AS entidad_id, d.legajo, d.periodo, v.desde AS fecha,
       IF(v.ant_estado IS NULL, 'alta', 'modificacion') AS accion,
       v.ant_estado AS estado_ant, v.estado AS estado_nuevo,
       IF(v.ant_estado IS NULL,
          CONCAT(v.fecha_inicio, ' / ', v.dias_computados, ' días / reintegro ', v.fecha_reintegro,
                 IF(v.fuera_de_norma, CONCAT(' / ', v.motivos_norma), '')),
          CONCAT(v.ant_inicio, '/', v.ant_dias, 'd -> ', v.fecha_inicio, '/', v.dias_computados, 'd',
                 IFNULL(CONCAT(' / ', v.motivo_autoriz), ''))) AS detalle,
       v.modificado_por AS usuario
  FROM (SELECT t.id, t.derecho_id, t.estado, t.fecha_inicio, t.dias_computados, t.fecha_reintegro,
               t.fuera_de_norma, t.motivos_norma, t.motivo_autoriz, t.modificado_por,
               t.ROW_START AS desde,
               LAG(t.estado)          OVER w AS ant_estado,
               LAG(t.fecha_inicio)    OVER w AS ant_inicio,
               LAG(t.dias_computados) OVER w AS ant_dias,
               LAG(t.fecha_reintegro) OVER w AS ant_reintegro
          FROM reg_licencia_anual_rrhh FOR SYSTEM_TIME ALL AS t
        WINDOW w AS (PARTITION BY t.id ORDER BY t.ROW_START)) v
  JOIN licencia_anual_derecho d ON d.id = v.derecho_id
 WHERE v.ant_estado IS NULL
    OR v.ant_estado <> v.estado
    OR v.ant_inicio <> v.fecha_inicio
    OR v.ant_dias <> v.dias_computados
    OR v.ant_reintegro <> v.fecha_reintegro
UNION ALL
SELECT 'interrupcion', v.id, d.legajo, d.periodo, v.desde,
       IF(v.ant_estado IS NULL, 'alta', 'cambio_estado'),
       v.ant_estado, v.estado,
       IF(v.ant_estado IS NULL,
          CONCAT(v.motivo, ' ', v.fecha_desde, ' a ', v.fecha_hasta, ' (', v.dias, ' días)',
                 IFNULL(CONCAT(' ', v.tipo_referencia, ' ', v.nro_referencia), '')),
          NULL),
       v.modificado_por
  FROM (SELECT i.id, i.tramo_id, i.estado, i.motivo, i.fecha_desde, i.fecha_hasta, i.dias,
               i.tipo_referencia, i.nro_referencia, i.modificado_por,
               i.ROW_START AS desde,
               LAG(i.estado) OVER (PARTITION BY i.id ORDER BY i.ROW_START) AS ant_estado
          FROM licencia_interrupcion FOR SYSTEM_TIME ALL AS i) v
  JOIN reg_licencia_anual_rrhh t ON t.id = v.tramo_id
  JOIN licencia_anual_derecho d ON d.id = t.derecho_id
 WHERE v.ant_estado IS NULL OR v.ant_estado <> v.estado
UNION ALL
SELECT 'derecho', v.id, v.legajo, v.periodo, v.desde,
       IF(v.ant_dias IS NULL, 'alta', 'ajuste'),
       NULL, NULL,
       IF(v.ant_dias IS NULL,
          CONCAT(v.dias_corresponden, ' días'),
          CONCAT(v.ant_dias, ' -> ', v.dias_corresponden, ' días', IFNULL(CONCAT(' / ', v.ajuste_motivo), ''))),
       v.modificado_por
  FROM (SELECT x.id, x.legajo, x.periodo, x.dias_corresponden, x.ajuste_motivo, x.modificado_por,
               x.ROW_START AS desde,
               LAG(x.dias_corresponden) OVER (PARTITION BY x.id ORDER BY x.ROW_START) AS ant_dias
          FROM licencia_anual_derecho FOR SYSTEM_TIME ALL AS x) v
 WHERE v.ant_dias IS NULL OR v.ant_dias <> v.dias_corresponden;


-- ---------------------------------------------------------------------
-- 5. CONTROLES (no cambian nada)
-- ---------------------------------------------------------------------
SELECT 'vacaciones_rrhh con estructura nueva' AS control,
       COUNT(*) AS cantidad FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vacaciones_rrhh'
          AND COLUMN_NAME IN ('fecha_reconocimiento', 'anios', 'meses', 'dias')
UNION ALL SELECT 'personal en vacaciones_rrhh', COUNT(*) FROM vacaciones_rrhh
UNION ALL SELECT 'funciones y procedimientos (deben ser 23)', COUNT(*) FROM information_schema.ROUTINES
           WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME REGEXP '^(fn|sp)_'
UNION ALL SELECT 'vistas (deben ser 6)', COUNT(*) FROM information_schema.VIEWS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME IN ('v_saldo_vacaciones', 'v_sin_pedido_principal', 'v_tramos_pendientes',
                                'v_interrupciones_pendientes', 'v_historia_licencias', 'v_historial_cambios')
UNION ALL SELECT 'periodos creados', COUNT(*) FROM periodo_vacaciones;
-- =====================================================================
