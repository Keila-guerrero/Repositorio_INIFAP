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

-- (Versión para MySQL en la nube: la base de datos ya la crea el proveedor, así que aquí no se
--  crea ni se selecciona. Tampoco trae la "migración" de archivos crudos: los datos se cargan
--  con importar_pdfs.js o con un respaldo mysqldump de tu base local.)
-- 2. Limpieza previa de tablas (en orden inverso a las llaves foráneas)
DROP TABLE IF EXISTS publicaciones;
DROP TABLE IF EXISTS formatos;
DROP TABLE IF EXISTS areas;

-- 3. Crear tabla de Áreas
CREATE TABLE areas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50)  NOT NULL UNIQUE,
  descripcion VARCHAR(200) NOT NULL,
  imagen      VARCHAR(200) NULL
) ENGINE=InnoDB;

-- 4. Crear tabla de Formatos
CREATE TABLE formatos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50)  NOT NULL UNIQUE,
  descripcion VARCHAR(200) NOT NULL
) ENGINE=InnoDB;

-- 5. Crear tabla de Publicaciones
CREATE TABLE publicaciones (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  titulo          VARCHAR(500) NOT NULL,
  anio            SMALLINT     NULL,
  id_area         INT          NOT NULL,
  id_formato      INT          NOT NULL,
  pdf_ruta        VARCHAR(600) NOT NULL UNIQUE,
  portada         VARCHAR(200) NULL,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  consultas       INT UNSIGNED NOT NULL DEFAULT 0,
  descargas       INT UNSIGNED NOT NULL DEFAULT 0,
  fecha_registro  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pub_area    FOREIGN KEY (id_area)    REFERENCES areas(id),
  CONSTRAINT fk_pub_formato FOREIGN KEY (id_formato) REFERENCES formatos(id),
  INDEX idx_area_formato (id_area, id_formato)
) ENGINE=InnoDB;

-- 6. Insertar catálogos iniciales
INSERT INTO areas (id, nombre, descripcion, imagen) VALUES
  (1, 'Agrícola', 'Técnicas de cultivo, variedades y manejo de parcelas.', 'img/area-agricola.jpg'),
  (2, 'Pecuario', 'Ganado bovino, praderas, forrajes y acuacultura.', 'img/area-pecuario.jpg'),
  (3, 'Forestal', 'Bosques, viveros y manejo forestal de la Sierra Madre Occidental.', 'img/area-forestal.jpg');

INSERT INTO formatos (id, nombre, descripcion) VALUES
  (1, 'Desplegables', 'Documentos con formatos interactivos o plegables especiales.'),
  (2, 'Folletos', 'Guías impresas y material informativo general.'),
  (3, 'Libro técnico', 'Textos técnicos detallados y manuales de referencia.'),
  (4, 'Publicaciones especiales', 'Ediciones exclusivas y reportes de investigación específicos.');

-- Fin: tablas y catálogos listos. Las publicaciones se cargan con importar_pdfs.js
