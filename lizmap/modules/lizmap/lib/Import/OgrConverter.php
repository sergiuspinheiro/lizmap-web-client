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
        'dxf', 'dwg', 'gpkg', 'gml', 'csv', 'kmz', 'sqlite', 'zip', 'geojsonl', 'geojsons', 'gpx', 'kml',
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

    /** @var string Path of ODAFileConverter or dwg2dxf, empty to look for them in the PATH */
    protected $dwgConverter = '';

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
     * Set the command converting DWG files to DXF.
     *
     * @param string $path path of ODAFileConverter (ODA File Converter) or dwg2dxf (LibreDWG)
     */
    public function setDwgConverter($path)
    {
        $this->dwgConverter = (string) $path;
    }

    /**
     * The command converting DWG files to DXF: the configured one, else
     * ODAFileConverter or dwg2dxf found in the PATH.
     *
     * @return null|string the command path
     */
    public function dwgConverter()
    {
        if ($this->dwgConverter !== '') {
            return is_executable($this->dwgConverter) ? $this->dwgConverter : null;
        }
        foreach (array('ODAFileConverter', 'dwg2dxf') as $command) {
            $output = array();
            $code = 1;
            @exec('command -v '.escapeshellarg($command).' 2>/dev/null', $output, $code);
            if ($code === 0 && isset($output[0]) && is_executable($output[0])) {
                return $output[0];
            }
        }

        return null;
    }

    /**
     * Convert a DWG file to DXF with ODA File Converter or LibreDWG.
     *
     * @param string $path   the DWG file path
     * @param string $outDir an empty directory for the conversion
     *
     * @return null|string the DXF file path, or null without converter
     *
     * @throws \RuntimeException
     */
    public function dwgToDxf($path, $outDir)
    {
        $converter = $this->dwgConverter();
        if ($converter === null) {
            return null;
        }
        $outDir = rtrim($outDir, '/');
        if (stripos(basename($converter), 'oda') !== false) {
            // ODA File Converter converts the files of a directory
            $inDir = $outDir.'/in';
            $dxfDir = $outDir.'/out';
            if (!@mkdir($inDir) || !@mkdir($dxfDir) || !@copy($path, $inDir.'/drawing.dwg')) {
                throw new \RuntimeException('Unable to prepare the DWG conversion');
            }
            $cmd = $this->command($converter, array($inDir, $dxfDir, 'ACAD2018', 'DXF', '0', '1', '*.DWG'));
            // It is a Qt application: it needs a display
            if (is_executable('/usr/bin/xvfb-run')) {
                $cmd = '/usr/bin/xvfb-run -a '.$cmd;
            } else {
                $cmd = 'QT_QPA_PLATFORM=offscreen '.$cmd;
            }
            // It writes its settings in the home directory
            $cmd = 'HOME='.escapeshellarg($outDir).' '.$cmd;
            $this->run($cmd);
            $found = glob($dxfDir.'/*.[dD][xX][fF]');
            if (!$found) {
                throw new \RuntimeException('ODA File Converter did not convert the DWG file');
            }

            return $found[0];
        }
        $dxf = $outDir.'/drawing.dxf';
        $this->run($this->command($converter, array('-y', '-o', $dxf, $path)));
        if (!is_file($dxf)) {
            throw new \RuntimeException('dwg2dxf did not convert the DWG file');
        }

        return $dxf;
    }

    /**
     * Coordinate reference system and extent of a layer.
     *
     * @param string   $dataset     the GDAL dataset path
     * @param string   $layer       the layer name
     * @param string[] $openOptions the -oo arguments
     *
     * @return array{hasCrs: bool, extent: null|float[]} the extent is [minx, miny, maxx, maxy]
     */
    public function layerInfo($dataset, $layer, $openOptions = array())
    {
        $output = array();
        $code = 1;
        $args = array_merge(array('-ro', '-so'), $openOptions, array($dataset, $layer));
        exec($this->command($this->ogrinfo, $args).' 2>/dev/null', $output, $code);
        $text = implode("\n", $output);
        $extent = null;
        if (preg_match('/^Extent: \(([-\d.eE+]+), ([-\d.eE+]+)\) - \(([-\d.eE+]+), ([-\d.eE+]+)\)/m', $text, $m)) {
            $extent = array((float) $m[1], (float) $m[2], (float) $m[3], (float) $m[4]);
        }

        return array(
            // ogrinfo prints "Layer SRS WKT:" followed by "(unknown)" for a layer without CRS
            'hasCrs' => $code === 0 && !preg_match('/Layer SRS WKT:\s*\(unknown\)/', $text),
            'extent' => $extent,
        );
    }

    /**
     * Can an extent be in longitudes and latitudes.
     *
     * @param null|float[] $extent [minx, miny, maxx, maxy]
     */
    public static function isGeographicExtent($extent): bool
    {
        return is_array($extent)
            && $extent[0] >= -180 && $extent[2] <= 180
            && $extent[1] >= -90 && $extent[3] <= 90;
    }

    /**
     * Convert a file to a GeoJSON FeatureCollection in EPSG:4326.
     *
     * Every layer of the dataset is converted, and the layer name is kept in
     * the `layer` property when there are several layers.
     *
     * Layers without CRS use the given CRS. Without it, a CrsRequiredException is
     * thrown for DXF files and for coordinates that can't be longitudes and latitudes,
     * else WGS 84 is used.
     *
     * @param string $path      the uploaded file path
     * @param string $extension the uploaded file extension
     * @param string $sourceCrs CRS of the layers without one, like EPSG:3763
     *
     * @return array the GeoJSON FeatureCollection, as an array
     *
     * @throws CrsRequiredException
     * @throws \RuntimeException
     */
    public function toGeoJson($path, $extension, $sourceCrs = '')
    {
        $extension = strtolower($extension);
        if ($extension == 'dwg') {
            // Converted to DXF, else read by the GDAL CAD driver (DWG R2000 only)
            $workDir = $path.'.dwg-convert';
            if (!@mkdir($workDir)) {
                throw new \RuntimeException('Unable to prepare the DWG conversion');
            }

            try {
                $dxf = $this->dwgToDxf($path, $workDir);
                if ($dxf !== null) {
                    return $this->toGeoJson($dxf, 'dxf', $sourceCrs);
                }
                if (count($this->layers($path)) == 0) {
                    throw new \RuntimeException('DWG files need ODA File Converter or LibreDWG on the server');
                }
            } finally {
                self::removeDir($workDir);
            }
        }
        $dataset = $this->datasetPath($path, $extension);
        if ($dataset === null) {
            throw new \RuntimeException('No vector file found in the archive');
        }
        $layers = $this->layers($dataset);
        if (count($layers) == 0) {
            throw new \RuntimeException('Unable to read the file');
        }
        if (!preg_match('/^EPSG:\d{4,6}$/', $sourceCrs)) {
            $sourceCrs = '';
        }
        $isCsv = ($extension == 'csv' || preg_match('/\.csv$/i', $dataset));
        $isDxf = in_array($extension, array('dxf', 'dwg')) || preg_match('/\.dxf$/i', $dataset);
        $openOptions = array();
        if ($isCsv) {
            // Read coordinates or WKT columns
            $openOptions = array(
                '-oo', 'X_POSSIBLE_NAMES=x,lon,lng,long,longitude,easting',
                '-oo', 'Y_POSSIBLE_NAMES=y,lat,latitude,northing',
                '-oo', 'GEOM_POSSIBLE_NAMES=wkt,geom,geometry,the_geom',
                '-oo', 'KEEP_GEOM_COLUMNS=NO',
            );
        }

        // Layers without CRS
        $sourceCrsOf = array();
        foreach ($layers as $layer) {
            $info = $this->layerInfo($dataset, $layer, $openOptions);
            if ($info['hasCrs']) {
                continue;
            }
            if ($sourceCrs) {
                $sourceCrsOf[$layer] = $sourceCrs;
            } elseif ($isDxf || ($info['extent'] !== null && !self::isGeographicExtent($info['extent']))) {
                throw new CrsRequiredException('The file has no coordinate reference system');
            } else {
                $sourceCrsOf[$layer] = 'EPSG:4326';
            }
        }

        $features = array();
        $size = 0;
        foreach ($layers as $layer) {
            $args = array_merge(array(
                '-f', 'GeoJSON', '/vsistdout/', $dataset, $layer,
                '-t_srs', 'EPSG:4326',
                '-lco', 'RFC7946=YES',
                // Do not follow links to remote resources
                '--config', 'GDAL_HTTP_TIMEOUT', '1',
                '--config', 'CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.lizmap-none',
                '--config', 'GML_SKIP_RESOLVE_ELEMS', 'ALL',
            ), $openOptions);
            if (isset($sourceCrsOf[$layer])) {
                $args[] = '-s_srs';
                $args[] = $sourceCrsOf[$layer];
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
     * Remove a directory and its content.
     *
     * @param string $dir
     */
    protected static function removeDir($dir)
    {
        if (!is_dir($dir) || is_link($dir)) {
            return;
        }
        foreach (array_diff(scandir($dir), array('.', '..')) as $item) {
            $itemPath = $dir.'/'.$item;
            if (is_dir($itemPath) && !is_link($itemPath)) {
                self::removeDir($itemPath);
            } else {
                @unlink($itemPath);
            }
        }
        @rmdir($dir);
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
