yarn dev
rm -rf /usr/local/var/lib/grafana/plugins/adx-kusto-bolt/*
cp -r adx-kusto-bolt/* /usr/local/var/lib/grafana/plugins/adx-kusto-bolt/
brew services restart grafana