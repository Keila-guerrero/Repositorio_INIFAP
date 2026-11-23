-- =====================================================================
--  Repositorio de Publicaciones - INIFAP Campo Experimental Valle del
--  Guadiana, Durango
--  Base de datos: repositorio_inifap   (MySQL / MariaDB)
--
--  Cómo usarlo:
--    * phpMyAdmin: pestaña "Importar" -> elegir este archivo -> Continuar
--    * Terminal:   mysql -u root -p < repositorio_inifap.sql
--
--  Sustituye a la base "gestor_inifap" anterior (que solo era un
--  inventario de archivos). Aquí cada PDF queda clasificado por
--  ÁREA (Agrícola, Pecuario, Forestal) y por FORMATO (Folletos, etc.)
-- =====================================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS repositorio_inifap
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE repositorio_inifap;

-- Se borran en orden inverso por las llaves foráneas (solo para reinstalar)
DROP TABLE IF EXISTS publicaciones;
DROP TABLE IF EXISTS formatos;
DROP TABLE IF EXISTS areas;

-- ---------------------------------------------------------------------
-- 1. ÁREAS DE INTERÉS  (primer paso que elige el visitante)
-- ---------------------------------------------------------------------
CREATE TABLE areas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50)  NOT NULL UNIQUE,
  descripcion VARCHAR(200) NOT NULL,
  imagen      VARCHAR(200) NULL          -- foto de la tarjeta, ej. img/area-agricola.jpg
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. FORMATOS  (segundo paso que elige el visitante)
-- ---------------------------------------------------------------------
CREATE TABLE formatos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50)  NOT NULL UNIQUE,
  descripcion VARCHAR(200) NOT NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. PUBLICACIONES  (cada PDF)
-- ---------------------------------------------------------------------
CREATE TABLE publicaciones (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  titulo         VARCHAR(500) NOT NULL,
  anio           SMALLINT     NULL,
  id_area        INT          NOT NULL,
  id_formato     INT          NOT NULL,
  pdf_ruta       VARCHAR(600) NOT NULL UNIQUE,   -- relativa a backend/uploads/
  hash_sha256    CHAR(64)     NULL UNIQUE,       -- huella del PDF: impide registrar el mismo PDF dos veces
  portada        VARCHAR(200) NULL,              -- ej. /portadas/12.jpg (1a página del PDF)
  activo         TINYINT(1)   NOT NULL DEFAULT 1,
  fecha_registro TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pub_area    FOREIGN KEY (id_area)    REFERENCES areas(id),
  CONSTRAINT fk_pub_formato FOREIGN KEY (id_formato) REFERENCES formatos(id),
  INDEX idx_area_formato (id_area, id_formato)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- DATOS INICIALES
-- ---------------------------------------------------------------------
INSERT INTO areas (nombre, descripcion, imagen) VALUES
  ('Agrícola', 'Técnicas de cultivo, variedades y manejo de parcelas.',              'img/area-agricola.jpg'),
  ('Pecuario', 'Ganado bovino, praderas, forrajes y acuacultura.',                   'img/area-pecuario.jpg'),
  ('Forestal', 'Bosques, viveros y manejo forestal de la Sierra Madre Occidental.',  'img/area-forestal.jpg');

INSERT INTO formatos (nombre, descripcion) VALUES
  ('Desplegables',            'Documentos con formatos interactivos o plegables especiales.'),
  ('Folletos',                'Guías impresas y material informativo general.'),
  ('Libro técnico',           'Textos técnicos detallados y manuales de referencia.'),
  ('Publicaciones especiales','Ediciones exclusivas y reportes de investigación específicos.');

-- Las publicaciones NO se capturan a mano: se cargan con
--   node importar_pdfs.js
-- (lee la carpeta backend/uploads/) o desde el panel admin.html
