CREATE TABLE IF NOT EXISTS lizmap_user_import(
  id integer PRIMARY KEY AUTOINCREMENT,
  usr_login text NOT NULL,
  ititle text NOT NULL,
  igeojson text NOT NULL,
  isize integer NOT NULL,
  updated text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usr_login) REFERENCES jlx_user (usr_login)
);

CREATE INDEX IF NOT EXISTS idx_lizmap_user_import_usr_login ON lizmap_user_import( usr_login );

CREATE TABLE IF NOT EXISTS lizmap_user_service(
  id integer PRIMARY KEY AUTOINCREMENT,
  usr_login text NOT NULL,
  stype text NOT NULL,
  surl text NOT NULL,
  stitle text NOT NULL,
  updated text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usr_login) REFERENCES jlx_user (usr_login)
);

CREATE INDEX IF NOT EXISTS idx_lizmap_user_service_usr_login ON lizmap_user_service( usr_login );
