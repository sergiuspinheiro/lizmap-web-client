CREATE TABLE IF NOT EXISTS lizmap_user_import(
  id serial PRIMARY KEY,
  usr_login text NOT NULL REFERENCES jlx_user (usr_login) ON UPDATE CASCADE ON DELETE CASCADE,
  ititle text NOT NULL,
  igeojson text NOT NULL,
  isize integer NOT NULL,
  updated timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lizmap_user_import_usr_login_idx ON lizmap_user_import( usr_login );
