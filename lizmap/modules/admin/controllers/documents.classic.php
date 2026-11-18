<?php

/**
 * Lizmap administration: reference documents linked to the geographic data
 * (regulations such as a PDM with its amendments, reports, notes...), used by
 * the AI assistant to analyse the layers.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

use Lizmap\Documents\DocumentStore;
use Lizmap\Documents\PdfText;

class documentsCtrl extends jController
{
    public $pluginParams = array(
        '*' => array('jacl2.right' => 'lizmap.admin.services.view'),
        'saveCollection' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'deleteCollection' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'upload' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'saveDocument' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'deleteDocument' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'savePart' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'addLink' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'deleteLink' => array('jacl2.right' => 'lizmap.admin.services.update'),
    );

    /** Maximum size of an uploaded file, in bytes */
    protected const MAX_FILE_SIZE = 50 * 1024 * 1024;

    /**
     * The collections of documents.
     *
     * @return jResponseHtml
     */
    public function index()
    {
        $store = $this->store();
        $collections = array();
        foreach ($store->collections() as $id => $collection) {
            $full = $store->collection($id);
            $collection['documentCount'] = count($full['documents'] ?? array());
            $collection['linkCount'] = count(array_filter($store->links(), static function ($link) use ($id) {
                return $link['collection'] === $id;
            }));
            $collections[] = $collection;
        }

        return $this->page('admin~documents', array(
            'collections' => $collections,
            'pdftotext' => PdfText::isAvailable(),
        ));
    }

    /**
     * A collection: its documents and its links to the layers.
     *
     * @return jResponseHtml|jResponseRedirect
     */
    public function collection()
    {
        $store = $this->store();
        $collection = $store->collection((string) $this->param('id'));
        if (!$collection) {
            return $this->toAction('admin~documents:index');
        }
        $links = array();
        foreach ($store->links() as $link) {
            if ($link['collection'] === $collection['id']) {
                $link['partsText'] = implode(', ', $link['parts']);
                $links[] = $link;
            }
        }
        foreach ($collection['documents'] as &$document) {
            $document['partCount'] = count($document['parts']);
            $document['revokedText'] = implode(', ', $document['revoked'] ?? array());
            // Not needed by the page
            unset($document['parts']);
        }
        unset($document);

        return $this->page('admin~documents_collection', array(
            'collection' => $collection,
            'links' => $links,
            'maps' => $this->maps(),
            'layersUrl' => jUrl::get('lizmap~catalog:layers'),
        ));
    }

    /**
     * The articles or sections of a document, or of the collection in force.
     *
     * @return jResponseHtml|jResponseRedirect
     */
    public function document()
    {
        $store = $this->store();
        $collection = $store->collection((string) $this->param('collection'));
        if (!$collection) {
            return $this->toAction('admin~documents:index');
        }
        $documentId = (string) $this->param('document', '');
        $document = null;
        if ($documentId !== '') {
            foreach ($collection['documents'] as $item) {
                if ($item['id'] === $documentId) {
                    $document = $item;
                }
            }
            if (!$document) {
                return $this->toAction('admin~documents:collection', array('id' => $collection['id']));
            }
            $parts = $document['parts'];
        } else {
            // The text in force at a date
            $date = (string) $this->param('date', '');
            $parts = array_values($store->parts($collection['id'], DocumentStore::validDate($date) ? $date : null));
        }

        foreach ($parts as &$part) {
            $part['heading'] = (preg_match('/^\d/', $part['label']) ? 'Artigo ' : '').$part['label'];
        }
        unset($part);

        return $this->page('admin~documents_document', array(
            'collection' => $collection,
            'document' => $document,
            'parts' => $parts,
            'date' => (string) $this->param('date', date('Y-m-d')),
        ));
    }

    /**
     * Download the file of a document.
     *
     * @return jResponseBinary|jResponseRedirect
     */
    public function file()
    {
        $store = $this->store();
        $collection = $store->collection((string) $this->param('collection'));
        foreach ($collection['documents'] ?? array() as $document) {
            if ($document['id'] === $this->param('document')) {
                $path = $store->documentFile($collection['id'], $document);
                if (is_file($path)) {
                    /** @var jResponseBinary $rep */
                    $rep = $this->getResponse('binary');
                    $rep->fileName = $path;
                    $rep->outputFileName = $document['fileName'];
                    $rep->doDownload = false;
                    $rep->mimeType = str_ends_with($path, '.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8';

                    return $rep;
                }
            }
        }

        return $this->toAction('admin~documents:index');
    }

    /**
     * Create or update a collection.
     *
     * @return jResponseRedirect
     */
    public function saveCollection()
    {
        if (!$this->checkToken()) {
            return $this->toAction('admin~documents:index');
        }
        $title = trim((string) $this->param('title', ''));
        if ($title === '') {
            jMessage::add(jLocale::get('admin~documents.error.title'), 'error');

            return $this->toAction('admin~documents:index');
        }
        $id = $this->store()->saveCollection(array(
            'id' => (string) $this->param('id', ''),
            'title' => mb_substr($title, 0, 200),
            'type' => (string) $this->param('type'),
            'description' => mb_substr((string) $this->param('description', ''), 0, 2000),
        ));

        return $this->toAction('admin~documents:collection', array('id' => $id));
    }

    /**
     * Delete a collection.
     *
     * @return jResponseRedirect
     */
    public function deleteCollection()
    {
        if ($this->checkToken()) {
            $this->store()->deleteCollection((string) $this->param('id'));
            jMessage::add(jLocale::get('admin~documents.deleted'), 'info');
        }

        return $this->toAction('admin~documents:index');
    }

    /**
     * Add a document to a collection.
     *
     * @return jResponseRedirect
     */
    public function upload()
    {
        $collectionId = (string) $this->param('collection');
        if (!$this->checkToken()) {
            return $this->toAction('admin~documents:collection', array('id' => $collectionId));
        }
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            jMessage::add(jLocale::get('admin~documents.error.file'), 'error');

            return $this->toAction('admin~documents:collection', array('id' => $collectionId));
        }
        if ($file['size'] > self::MAX_FILE_SIZE) {
            jMessage::add(jLocale::get('admin~documents.error.size'), 'error');

            return $this->toAction('admin~documents:collection', array('id' => $collectionId));
        }

        try {
            // Reading a long PDF takes time
            set_time_limit(300);
            $document = $this->store()->addDocument(
                $collectionId,
                $file['tmp_name'],
                (string) $file['name'],
                mb_substr(trim((string) $this->param('title', '')), 0, 200),
                (string) $this->param('date', ''),
            );
            jMessage::add(jLocale::get('admin~documents.uploaded', array(count($document['parts']))), 'info');
        } catch (\RuntimeException $e) {
            jMessage::add(jLocale::get('admin~documents.error.read').' ('.$e->getMessage().')', 'error');
        }

        return $this->toAction('admin~documents:collection', array('id' => $collectionId));
    }

    /**
     * Change the title and the date of a document.
     *
     * @return jResponseRedirect
     */
    public function saveDocument()
    {
        $collectionId = (string) $this->param('collection');
        $documentId = (string) $this->param('document');
        if ($this->checkToken()) {
            $this->store()->updateDocument($collectionId, $documentId, array(
                'title' => mb_substr((string) $this->param('title', ''), 0, 200),
                'date' => (string) $this->param('date', ''),
            ));
            jMessage::add(jLocale::get('admin~documents.saved'), 'info');
        }

        return $this->toAction('admin~documents:document', array('collection' => $collectionId, 'document' => $documentId));
    }

    /**
     * Delete a document.
     *
     * @return jResponseRedirect
     */
    public function deleteDocument()
    {
        $collectionId = (string) $this->param('collection');
        if ($this->checkToken()) {
            $this->store()->deleteDocument($collectionId, (string) $this->param('document'));
            jMessage::add(jLocale::get('admin~documents.deleted'), 'info');
        }

        return $this->toAction('admin~documents:collection', array('id' => $collectionId));
    }

    /**
     * Correct the title and the text of an article or a section.
     *
     * @return jResponseRedirect
     */
    public function savePart()
    {
        $collectionId = (string) $this->param('collection');
        $documentId = (string) $this->param('document');
        $number = (string) $this->param('number');
        if ($this->checkToken()) {
            $this->store()->updateDocument($collectionId, $documentId, array(
                'title' => mb_substr((string) $this->param('title', ''), 0, 300),
                'text' => mb_substr((string) $this->param('text', ''), 0, 100000),
            ), $number);
            jMessage::add(jLocale::get('admin~documents.saved'), 'info');
        }
        $rep = $this->toAction('admin~documents:document', array('collection' => $collectionId, 'document' => $documentId));
        $rep->anchor = 'part-'.preg_replace('/[^A-Za-z0-9-]/', '', $number);

        return $rep;
    }

    /**
     * Link a layer to the collection.
     *
     * @return jResponseRedirect
     */
    public function addLink()
    {
        $collectionId = (string) $this->param('collection');
        if (!$this->checkToken()) {
            return $this->toAction('admin~documents:collection', array('id' => $collectionId));
        }
        $map = explode('~', (string) $this->param('map', ''), 2);
        $layer = trim((string) $this->param('layer', ''));
        if (count($map) !== 2 || $map[0] === '' || $map[1] === '') {
            jMessage::add(jLocale::get('admin~documents.error.map'), 'error');

            return $this->toAction('admin~documents:collection', array('id' => $collectionId));
        }

        try {
            $this->store()->addLink(array(
                'collection' => $collectionId,
                'repository' => $map[0],
                'project' => $map[1],
                'layer' => mb_substr($layer, 0, 200),
                'field' => mb_substr((string) $this->param('field', ''), 0, 200),
                'value' => mb_substr((string) $this->param('value', ''), 0, 500),
                'parts' => mb_substr((string) $this->param('parts', ''), 0, 2000),
                'note' => mb_substr((string) $this->param('note', ''), 0, 2000),
            ));
            jMessage::add(jLocale::get('admin~documents.saved'), 'info');
        } catch (\RuntimeException $e) {
            jMessage::add($e->getMessage(), 'error');
        }

        return $this->toAction('admin~documents:collection', array('id' => $collectionId));
    }

    /**
     * Delete a link.
     *
     * @return jResponseRedirect
     */
    public function deleteLink()
    {
        $collectionId = (string) $this->param('collection');
        if ($this->checkToken()) {
            $this->store()->deleteLink((string) $this->param('link'));
            jMessage::add(jLocale::get('admin~documents.deleted'), 'info');
        }

        return $this->toAction('admin~documents:collection', array('id' => $collectionId));
    }

    /**
     * @return DocumentStore the documents
     */
    protected function store()
    {
        return new DocumentStore(jApp::varPath('documents/'));
    }

    /**
     * An administration page.
     *
     * @param string $template the template
     * @param array  $data     the template data
     *
     * @return jResponseHtml
     */
    protected function page($template, array $data)
    {
        /** @var jResponseHtml $rep */
        $rep = $this->getResponse('html');
        $tpl = new jTpl();
        $tpl->assign($data);
        $tpl->assign('token', $this->token());
        $tpl->assign('canUpdate', jAcl2::check('lizmap.admin.services.update'));
        $rep->body->assign('MAIN', $tpl->fetch($template));
        $rep->body->assign('selectedMenuItem', 'lizmap_documents');

        return $rep;
    }

    /**
     * @param string $action the action
     * @param array  $params the parameters
     *
     * @return jResponseRedirect
     */
    protected function toAction($action, array $params = array())
    {
        /** @var jResponseRedirect $rep */
        $rep = $this->getResponse('redirect');
        $rep->action = $action;
        $rep->params = $params;

        return $rep;
    }

    /**
     * @return string the token of the forms of the session, against cross-site requests
     */
    protected function token()
    {
        if (empty($_SESSION['lizmapDocumentsToken'])) {
            $_SESSION['lizmapDocumentsToken'] = bin2hex(random_bytes(16));
        }

        return $_SESSION['lizmapDocumentsToken'];
    }

    /**
     * @return bool true for a POST request with the token of the session
     */
    protected function checkToken()
    {
        return $this->request->isPostMethod()
            && !empty($_SESSION['lizmapDocumentsToken'])
            && hash_equals($_SESSION['lizmapDocumentsToken'], (string) $this->param('token', ''));
    }

    /**
     * @return list<array{id: string, title: string}> the maps: repository~project and title
     */
    protected function maps()
    {
        $maps = array();
        foreach (lizmap::getRepositoryList() as $repoKey) {
            $lrep = lizmap::getRepository($repoKey);
            if (!$lrep || !$lrep->hasValidPath()) {
                continue;
            }
            foreach ($lrep->getProjectsMainData() as $meta) {
                $maps[] = array(
                    'id' => $repoKey.'~'.$meta->getId(),
                    'title' => $lrep->getLabel().' — '.$meta->getTitle(),
                );
            }
        }

        return $maps;
    }
}
