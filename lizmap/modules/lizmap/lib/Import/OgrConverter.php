<?php

/**
 * Convert vector files to GeoJSON with GDAL/OGR (ogr2ogr).
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Import;

class OgrConverter
{
    /**
     * Extensions of the uploaded files that can be converted.
     */
    public const EXTENSIONS = array(
        'dxf', 'gpkg', 'gml', 'csv', 'kmz', 'sqlite', 'zip', 'geojsonl', 'geojsons', 'gpx', 'kml',
    );

    /**
     * Extensions of the main file to look for inside a zip archive.
     */
    public const ZIP_EXTENSIONS = array('shp', 'tab', 'mif', 'gpkg', 'dxf', 'gml', 'kml', 'csv', 'geojson', 'json', 'gdb');

    /** Maximum size of the files of a zip archive, in bytes */
    public const MAX_UNCOMPRESSED_SIZE = 200000000;

    /** @var string */
    protected $ogr2ogr;

    /** @var string */
    protected $ogrinfo;

    /** @var int Maximum size of the GeoJSON output, in bytes */
    protected $maxOutputSize;

    /** @var int Maximum duration of a command, in seconds */
    protected $timeout;

    /**
     * @param string $binDir        Directory of the GDAL commands, empty to use the PATH
     * @param int    $maxOutputSize Maximum size of the GeoJSON output, in bytes
     * @param int    $timeout       Maximum duration of a command, in seconds
     */
    public function __construct($binDir = '', $maxOutputSize = 50000000, $timeout = 60)
    {
        $prefix = $binDir ? rtrim($binDir, '/').'/' : '';
        $this->ogr2ogr = $prefix.'ogr2ogr';
        $this->ogrinfo = $prefix.'ogrinfo';
        $this->maxOutputSize = $maxOutputSize;
        $this->timeout = $timeout;
    }

    /**
     * Is ogr2ogr available.
     */
    public function isAvailable(): bool
    {
        $output = array();
        $code = 1;
        @exec(escapeshellarg($this->ogr2ogr).' --version 2>/dev/null', $output, $code);

        return $code === 0;
    }

    /**
     * Is the file extension supported.
     *
     * @param string $extension
     */
    public static function isSupported($extension): bool
    {
        return in_array(strtolower($extension), self::EXTENSIONS, true);
    }

    /**
     * GDAL path of the dataset to read.
     *
     * Zip archives are read with /vsizip/, choosing the first file with a
     * known extension. Other files are read directly.
     *
     * @param string $path      the uploaded file path
     * @param string $extension the uploaded file extension
     *
     * @return null|string the GDAL dataset path or null if nothing can be read
     */
    public function datasetPath($path, $extension)
    {
        $extension = strtolower($extension);
        if ($extension == 'kmz') {
            return '/vsizip/'.$path;
        }
        if ($extension != 'zip') {
            return $path;
        }

        $zip = new \ZipArchive();
        if ($zip->open($path) !== true) {
            return null;
        }
        // Refuse archives expanding to huge files (zip bombs)
        $uncompressed = 0;
        for ($i = 0; $i < $zip->numFiles; ++$i) {
            $stat = $zip->statIndex($i);
            $uncompressed += $stat ? $stat['size'] : 0;
        }
        if ($uncompressed > self::MAX_UNCOMPRESSED_SIZE) {
            $zip->close();

            return null;
        }
        $found = null;
        foreach (self::ZIP_EXTENSIONS as $ext) {
            for ($i = 0; $i < $zip->numFiles; ++$i) {
                $name = $zip->getNameIndex($i);
                // A file geodatabase is a directory
                if ($ext == 'gdb' && preg_match('/^(.*\.gdb)\//i', $name, $m)) {
                    $found = $m[1];

                    break 2;
                }
                if (strtolower(pathinfo($name, PATHINFO_EXTENSION)) == $ext
                    && strpos($name, '__MACOSX') !== 0) {
                    $found = $name;

                    break 2;
                }
            }
        }
        $zip->close();
        if ($found === null || strpos($found, '..') !== false) {
            return null;
        }

        return '/vsizip/'.$path.'/'.$found;
    }

    /**
     * Layers of a dataset.
     *
     * @param string $dataset the GDAL dataset path
     *
     * @return string[] the layer names
     */
    public function layers($dataset)
    {
        $output = array();
        $code = 1;
        exec($this->command($this->ogrinfo, array('-ro', '-q', $dataset)).' 2>/dev/null', $output, $code);
        if ($code !== 0) {
            return array();
        }
        $layers = array();
        foreach ($output as $line) {
            // "1: layer_name (Point)" or "1: layer_name"
            if (preg_match('/^\d+: (.+?)(?: \([^()]*\))?$/', trim($line), $m)) {
                $layers[] = $m[1];
            }
        }

        return $layers;
    }

    /**
     * Convert a file to a GeoJSON FeatureCollection in EPSG:4326.
     *
     * Every layer of the dataset is converted, and the layer name is kept in
     * the `layer` property when there are several layers.
     *
     * @param string $path      the uploaded file path
     * @param string $extension the uploaded file extension
     * @param string $sourceCrs CRS of CSV and DXF files, which have none, like EPSG:3763
     *
     * @return array the GeoJSON FeatureCollection, as an array
     *
     * @throws \RuntimeException
     */
    public function toGeoJson($path, $extension, $sourceCrs = '')
    {
        $extension = strtolower($extension);
        $dataset = $this->datasetPath($path, $extension);
        if ($dataset === null) {
            throw new \RuntimeException('No vector file found in the archive');
        }
        $layers = $this->layers($dataset);
        if (count($layers) == 0) {
            throw new \RuntimeException('Unable to read the file');
        }

        $features = array();
        $size = 0;
        foreach ($layers as $layer) {
            $args = array(
                '-f', 'GeoJSON', '/vsistdout/', $dataset, $layer,
                '-t_srs', 'EPSG:4326',
                '-lco', 'RFC7946=YES',
                // Do not follow links to remote resources
                '--config', 'GDAL_HTTP_TIMEOUT', '1',
                '--config', 'CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.lizmap-none',
                '--config', 'GML_SKIP_RESOLVE_ELEMS', 'ALL',
            );
            $isCsv = ($extension == 'csv' || preg_match('/\.csv$/i', $dataset));
            if ($isCsv) {
                // Read coordinates or WKT columns
                $args[] = '-oo';
                $args[] = 'X_POSSIBLE_NAMES=x,lon,lng,long,longitude,easting';
                $args[] = '-oo';
                $args[] = 'Y_POSSIBLE_NAMES=y,lat,latitude,northing';
                $args[] = '-oo';
                $args[] = 'GEOM_POSSIBLE_NAMES=wkt,geom,geometry,the_geom';
                $args[] = '-oo';
                $args[] = 'KEEP_GEOM_COLUMNS=NO';
            }
            // CSV and DXF files have no CRS: use the given one, or WGS 84 for CSV
            if ($isCsv || $extension == 'dxf' || preg_match('/\.dxf$/i', $dataset)) {
                if ($sourceCrs && preg_match('/^EPSG:\d+$/', $sourceCrs)) {
                    $args[] = '-s_srs';
                    $args[] = $sourceCrs;
                } elseif ($isCsv) {
                    $args[] = '-s_srs';
                    $args[] = 'EPSG:4326';
                }
            }
            $output = $this->run($this->command($this->ogr2ogr, $args));
            $size += strlen($output);
            if ($size > $this->maxOutputSize) {
                throw new \RuntimeException('The file is too big');
            }
            $collection = json_decode($output, true);
            if (!is_array($collection) || !array_key_exists('features', $collection)) {
                continue;
            }
            foreach ($collection['features'] as $feature) {
                if (!isset($feature['geometry'])) {
                    continue;
                }
                if (count($layers) > 1) {
                    if (!isset($feature['properties']) || !is_array($feature['properties'])) {
                        $feature['properties'] = array();
                    }
                    $feature['properties']['layer'] = $layer;
                }
                $features[] = $feature;
            }
        }

        return array(
            'type' => 'FeatureCollection',
            'features' => $features,
        );
    }

    /**
     * Build a shell command with escaped arguments.
     *
     * @param string   $bin
     * @param string[] $args
     *
     * @return string
     */
    protected function command($bin, $args)
    {
        $cmd = escapeshellarg($bin);
        foreach ($args as $arg) {
            $cmd .= ' '.escapeshellarg($arg);
        }
        if ($this->timeout > 0 && is_executable('/usr/bin/timeout')) {
            $cmd = '/usr/bin/timeout '.intval($this->timeout).' '.$cmd;
        }

        return $cmd;
    }

    /**
     * Run a command and return its standard output.
     *
     * @param string $cmd
     *
     * @return string
     *
     * @throws \RuntimeException
     */
    protected function run($cmd)
    {
        $descriptors = array(1 => array('pipe', 'w'), 2 => array('pipe', 'w'));
        $process = proc_open($cmd, $descriptors, $pipes);
        if (!is_resource($process)) {
            throw new \RuntimeException('Unable to run ogr2ogr');
        }
        $output = '';
        while (!feof($pipes[1])) {
            $output .= fread($pipes[1], 65536);
            if (strlen($output) > $this->maxOutputSize) {
                fclose($pipes[1]);
                fclose($pipes[2]);
                proc_terminate($process);
                proc_close($process);

                throw new \RuntimeException('The file is too big');
            }
        }
        fclose($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[2]);
        $code = proc_close($process);
        if ($code !== 0) {
            throw new \RuntimeException('Conversion failed: '.trim($errors));
        }

        return $output;
    }
}
