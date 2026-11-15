CREATE TABLE IF NOT EXISTS lizmap_map_view(
  id serial PRIMARY KEY,
  usr_login text NOT NULL REFERENCES jlx_user (usr_login) ON UPDATE CASCADE ON DELETE CASCADE,
  vname text NOT NULL,
  vmap text NOT NULL,
  vconfig text NOT NULL,
  updated timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lizmap_map_view_usr_login_vmap_idx ON lizmap_map_view( usr_login, vmap );
