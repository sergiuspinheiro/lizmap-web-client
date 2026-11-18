<?php

/**
 * Reference documents linked to the geographic data: collections of documents
 * (a regulation such as a PDM with its amendments, or any other documents),
 * and links between the layers of the projects and the documents.
 *
 * Stored as JSON files in a directory of lizmap/var:
 * - index.json: the collections and the links
 * - <collection>.json: the documents of a collection, with their articles or sections
 * - <collection>/: the files of the documents
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Documents;

class DocumentStore
{
    /** A regulation: articles, documents merged by date */
    public const TYPE_REGULATION = 'regulation';

    /** Other documents: sections */
    public const TYPE_DOCUMENTS = 'documents';

    /** Extensions of the files that can be read */
    public const EXTENSIONS = array('pdf', 'txt', 'md');

    /** @var string the directory */
    protected $dir;

    /** @var string the pdftotext command */
    protected $pdftotext;

    /**
     * @param string $dir       the directory of the documents
     * @param string $pdftotext the pdftotext command
     */
    public function __construct($dir, $pdftotext = 'pdftotext')
    {
        $this->dir = rtrim($dir, '/').'/';
        $this->pdftotext = $pdftotext;
    }

    /**
     * @return array<string, array> the collections by id: id, title, type, description
     */
    public function collections()
    {
        return $this->readIndex()['collections'];
    }

    /**
     * A collection with its documents.
     *
     * @param string $id the collection id
     *
     * @return null|array the collection, with its documents
     */
    public function collection($id)
    {
        $collections = $this->collections();
        if (!isset($collections[$id])) {
            return null;
        }
        $data = $this->readJson($this->collectionPath($id));

        return $collections[$id] + array('documents' => $data['documents'] ?? array());
    }

    /**
     * Create or update a collection.
     *
     * @param array $data title, type, description, and id to update
     *
     * @return string the collection id
     */
    public function saveCollection(array $data)
    {
        $index = $this->readIndex();
        $id = (string) ($data['id'] ?? '');
        if ($id === '' || !isset($index['collections'][$id])) {
            $id = $this->newId($data['title'] ?? 'collection', array_keys($index['collections']));
        }
        $type = ($data['type'] ?? '') === self::TYPE_REGULATION ? self::TYPE_REGULATION : self::TYPE_DOCUMENTS;
        $index['collections'][$id] = array(
            'id' => $id,
            'title' => trim((string) ($data['title'] ?? '')) ?: $id,
            'type' => $type,
            'description' => trim((string) ($data['description'] ?? '')),
        );
        $this->writeIndex($index);

        return $id;
    }

    /**
     * Delete a collection, its documents and its links.
     *
     * @param string $id the collection id
     */
    public function deleteCollection($id)
    {
        $index = $this->readIndex();
        if (!isset($index['collections'][$id])) {
            return;
        }
        unset($index['collections'][$id]);
        $index['links'] = array_values(array_filter($index['links'], static function ($link) use ($id) {
            return $link['collection'] !== $id;
        }));
        $this->writeIndex($index);
        foreach (glob($this->dir.$id.'/*') ?: array() as $file) {
            @unlink($file);
        }
        @rmdir($this->dir.$id);
        @unlink($this->collectionPath($id));
    }

    /**
     * Add a document to a collection: its file is kept, its text is split into
     * articles (regulation) or sections.
     *
     * @param string $collectionId the collection id
     * @param string $path         the file
     * @param string $fileName     the original name of the file
     * @param string $title        the title of the document
     * @param string $date         the date of entry into force, Y-m-d
     *
     * @return array the document
     *
     * @throws \RuntimeException if the file cannot be read
     */
    public function addDocument($collectionId, $path, $fileName, $title, $date)
    {
        $collection = $this->collection($collectionId);
        if (!$collection) {
            throw new \RuntimeException('Unknown collection');
        }
        $extension = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));
        if (!in_array($extension, self::EXTENSIONS, true)) {
            throw new \RuntimeException('Only PDF, TXT and MD files can be read');
        }
        $text = $extension === 'pdf' ? PdfText::fromFile($path, $this->pdftotext) : (string) file_get_contents($path);
        if (!mb_check_encoding($text, 'UTF-8')) {
            $text = mb_convert_encoding($text, 'UTF-8', 'ISO-8859-1');
        }

        $parts = array();
        $revoked = array();
        $kind = 'articles';
        if ($collection['type'] === self::TYPE_REGULATION) {
            $parsed = ArticleParser::parse($text);
            $parts = $parsed['articles'];
            $revoked = $parsed['revoked'];
        }
        if (count($parts) === 0) {
            $parts = SectionParser::parse($text);
            $kind = 'sections';
        }

        $ids = array_column($collection['documents'], 'id');
        $id = $this->newId($title ?: pathinfo($fileName, PATHINFO_FILENAME), $ids);
        if (!is_dir($this->dir.$collectionId)) {
            mkdir($this->dir.$collectionId, 0750, true);
        }
        $stored = $id.'.'.$extension;
        if (!copy($path, $this->dir.$collectionId.'/'.$stored)) {
            throw new \RuntimeException('The file cannot be saved');
        }
        $document = array(
            'id' => $id,
            'title' => trim((string) $title) ?: pathinfo($fileName, PATHINFO_FILENAME),
            'date' => self::validDate($date) ? $date : date('Y-m-d'),
            'file' => $stored,
            'fileName' => basename($fileName),
            'kind' => $kind,
            'parts' => $parts,
            'revoked' => $revoked,
        );
        $documents = $collection['documents'];
        $documents[] = $document;
        $this->writeJson($this->collectionPath($collectionId), array('documents' => $documents));

        return $document;
    }

    /**
     * Delete a document.
     *
     * @param string $collectionId the collection id
     * @param string $documentId   the document id
     */
    public function deleteDocument($collectionId, $documentId)
    {
        $collection = $this->collection($collectionId);
        if (!$collection) {
            return;
        }
        $documents = array();
        foreach ($collection['documents'] as $document) {
            if ($document['id'] === $documentId) {
                @unlink($this->dir.$collectionId.'/'.basename($document['file']));
            } else {
                $documents[] = $document;
            }
        }
        $this->writeJson($this->collectionPath($collectionId), array('documents' => $documents));
    }

    /**
     * Change a document: title, date, or the title and the text of one of its parts.
     *
     * @param string      $collectionId the collection id
     * @param string      $documentId   the document id
     * @param array       $data         title and date of the document, or title and text of the part
     * @param null|string $partNumber   the number of the part to change, null for the document
     *
     * @return bool true if the document was found
     */
    public function updateDocument($collectionId, $documentId, array $data, $partNumber = null)
    {
        $collection = $this->collection($collectionId);
        if (!$collection) {
            return false;
        }
        $found = false;
        foreach ($collection['documents'] as &$document) {
            if ($document['id'] !== $documentId) {
                continue;
            }
            if ($partNumber === null) {
                $document['title'] = trim((string) ($data['title'] ?? $document['title'])) ?: $document['title'];
                if (self::validDate($data['date'] ?? '')) {
                    $document['date'] = $data['date'];
                }
                $found = true;

                continue;
            }
            foreach ($document['parts'] as &$part) {
                if ($part['number'] === $partNumber) {
                    $part['title'] = trim((string) ($data['title'] ?? $part['title']));
                    $part['text'] = trim((string) ($data['text'] ?? $part['text']));
                    $found = true;
                }
            }
            unset($part);
        }
        unset($document);
        if ($found) {
            $this->writeJson($this->collectionPath($collectionId), array('documents' => $collection['documents']));
        }

        return $found;
    }

    /**
     * The path of the file of a document.
     *
     * @param string $collectionId the collection id
     * @param array  $document     the document
     *
     * @return string the path
     */
    public function documentFile($collectionId, array $document)
    {
        return $this->dir.basename($collectionId).'/'.basename($document['file']);
    }

    /**
     * The parts of a collection in force: for a regulation, the articles in force
     * at the date; else the sections of every document.
     *
     * @param string      $collectionId the collection id
     * @param null|string $date         Y-m-d, today by default
     *
     * @return array<string, array> the parts, by number (with the document id for the sections)
     */
    public function parts($collectionId, $date = null)
    {
        $collection = $this->collection($collectionId);
        if (!$collection) {
            return array();
        }
        if ($collection['type'] === self::TYPE_REGULATION) {
            // The documents without articles (e.g. notices) are not merged
            $documents = array_filter($collection['documents'], static function ($document) {
                return ($document['kind'] ?? 'articles') === 'articles';
            });

            return (new Regulation(array_map(static function ($document) {
                return $document + array('articles' => $document['parts']);
            }, array_values($documents))))->inForce($date);
        }
        $parts = array();
        foreach ($collection['documents'] as $document) {
            foreach ($document['parts'] as $part) {
                $number = $document['id'].':'.$part['number'];
                $parts[$number] = $part + array(
                    'document' => array('id' => $document['id'], 'title' => $document['title'], 'date' => $document['date']),
                    'revoked' => false,
                    'previous' => null,
                );
                $parts[$number]['number'] = $number;
                $parts[$number]['label'] = $document['title'].' '.$part['label'];
            }
        }

        return $parts;
    }

    /**
     * @return list<array> the links: id, collection, repository, project, layer, field, value, parts, note
     */
    public function links()
    {
        return $this->readIndex()['links'];
    }

    /**
     * Add a link between a layer (all its features, or the features having a value)
     * and a collection (all its parts, or some of them).
     *
     * @param array $data collection, repository, project, layer, field, value, parts (list or comma separated), note
     *
     * @return array the link
     */
    public function addLink(array $data)
    {
        $index = $this->readIndex();
        $parts = $data['parts'] ?? array();
        if (!is_array($parts)) {
            $parts = preg_split('/[,;\s]+/u', (string) $parts, -1, PREG_SPLIT_NO_EMPTY);
        }
        $collection = $index['collections'][$data['collection'] ?? ''] ?? null;
        if (!$collection) {
            throw new \RuntimeException('Unknown collection');
        }
        if ($collection['type'] === self::TYPE_REGULATION) {
            $parts = array_map(array(ArticleParser::class, 'normalizeNumber'), $parts);
        }
        $link = array(
            'id' => bin2hex(random_bytes(6)),
            'collection' => $collection['id'],
            'repository' => trim((string) ($data['repository'] ?? '')),
            'project' => trim((string) ($data['project'] ?? '')),
            'layer' => trim((string) ($data['layer'] ?? '')),
            'field' => trim((string) ($data['field'] ?? '')),
            'value' => trim((string) ($data['value'] ?? '')),
            'parts' => array_values(array_unique(array_map('strval', $parts))),
            'note' => trim((string) ($data['note'] ?? '')),
        );
        $index['links'][] = $link;
        $this->writeIndex($index);

        return $link;
    }

    /**
     * Delete a link.
     *
     * @param string $id the link id
     */
    public function deleteLink($id)
    {
        $index = $this->readIndex();
        $index['links'] = array_values(array_filter($index['links'], static function ($link) use ($id) {
            return $link['id'] !== $id;
        }));
        $this->writeIndex($index);
    }

    /**
     * The links of a layer.
     *
     * @param string $repository the repository key
     * @param string $project    the project key
     * @param string $layer      the layer name
     *
     * @return list<array> the links
     */
    public function linksOf($repository, $project, $layer)
    {
        return array_values(array_filter($this->links(), static function ($link) use ($repository, $project, $layer) {
            return $link['repository'] === $repository && $link['project'] === $project
                && ($link['layer'] === $layer || $link['layer'] === '');
        }));
    }

    /**
     * @param string $date a date
     *
     * @return bool true for a Y-m-d date
     */
    public static function validDate($date)
    {
        $parsed = \DateTime::createFromFormat('!Y-m-d', (string) $date);

        return $parsed !== false && $parsed->format('Y-m-d') === $date;
    }

    /**
     * @return array{collections: array<string, array>, links: list<array>}
     */
    protected function readIndex()
    {
        $index = $this->readJson($this->dir.'index.json');

        return array(
            'collections' => is_array($index['collections'] ?? null) ? $index['collections'] : array(),
            'links' => is_array($index['links'] ?? null) ? array_values($index['links']) : array(),
        );
    }

    /**
     * @param array $index the index
     */
    protected function writeIndex(array $index)
    {
        $this->writeJson($this->dir.'index.json', $index);
    }

    /**
     * @param string $id the collection id
     *
     * @return string the path of the JSON file of the collection
     */
    protected function collectionPath($id)
    {
        return $this->dir.basename($id).'.json';
    }

    /**
     * @param string $path a JSON file
     *
     * @return array the content, an empty array if the file does not exist
     */
    protected function readJson($path)
    {
        if (!is_file($path)) {
            return array();
        }
        $data = json_decode((string) file_get_contents($path), true);

        return is_array($data) ? $data : array();
    }

    /**
     * @param string $path a JSON file
     * @param array  $data the content
     */
    protected function writeJson($path, array $data)
    {
        if (!is_dir($this->dir)) {
            mkdir($this->dir, 0750, true);
        }
        $temp = $path.'.'.bin2hex(random_bytes(4)).'.tmp';
        file_put_contents($temp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
        rename($temp, $path);
    }

    /**
     * A new id from a title.
     *
     * @param string       $title    the title
     * @param list<string> $existing the existing ids
     *
     * @return string the id: letters, digits and dashes
     */
    protected function newId($title, array $existing)
    {
        $id = (string) $title;
        if (function_exists('iconv')) {
            $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $id);
            if ($ascii !== false) {
                $id = $ascii;
            }
        }
        $id = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($id)), '-');
        $id = substr($id, 0, 40) ?: 'document';
        $base = $id;
        for ($i = 2; in_array($id, $existing, true) || $id === 'index'; ++$i) {
            $id = $base.'-'.$i;
        }

        return $id;
    }
}
