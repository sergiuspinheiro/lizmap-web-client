CREATE TABLE IF NOT EXISTS lizmap_map_view(
  id integer PRIMARY KEY AUTOINCREMENT,
  usr_login text NOT NULL,
  vname text NOT NULL,
  vmap text NOT NULL,
  vconfig text NOT NULL,
  updated text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usr_login) REFERENCES jlx_user (usr_login)
);

CREATE INDEX IF NOT EXISTS idx_lizmap_map_view_usr_login_vmap ON lizmap_map_view( usr_login, vmap );
