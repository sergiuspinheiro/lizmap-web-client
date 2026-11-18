<?php

/**
 * A regulation (e.g. the regulation of a PDM) made of several documents:
 * the first publication, then amendments and republications.
 *
 * The text in force of an article is the one of the last document in force
 * changing it. An amendment often keeps parts of an article with "[...]":
 * the previous version is then kept too.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Documents;

class Regulation
{
    /** @var list<array> documents: id, title, date (Y-m-d, entry into force), articles, revoked */
    protected $documents;

    /**
     * @param list<array> $documents the documents
     */
    public function __construct(array $documents)
    {
        usort($documents, static function ($a, $b) {
            return strcmp((string) ($a['date'] ?? ''), (string) ($b['date'] ?? ''));
        });
        $this->documents = $documents;
    }

    /**
     * The articles in force at a date.
     *
     * @param null|string $date Y-m-d, today by default
     *
     * @return array<string, array> the articles by normalized number, in the order of the numbers,
     *                              with the document of their version, and the previous version
     *                              when the last one keeps parts of it ("[...]")
     */
    public function inForce($date = null)
    {
        $date = $date ?? date('Y-m-d');
        $articles = array();
        foreach ($this->documents as $document) {
            if ((string) ($document['date'] ?? '') > $date) {
                continue;
            }
            $source = array(
                'id' => (string) ($document['id'] ?? ''),
                'title' => (string) ($document['title'] ?? ''),
                'date' => (string) ($document['date'] ?? ''),
            );
            foreach ($document['articles'] ?? array() as $article) {
                $number = ArticleParser::normalizeNumber($article['number'] ?? '');
                if ($number === '') {
                    continue;
                }
                $version = $article + array('title' => '', 'text' => '', 'chapter' => '', 'section' => '');
                $version['number'] = $number;
                $version['label'] = ArticleParser::label($number);
                $version['document'] = $source;
                $version['revoked'] = false;
                $previous = $articles[$number] ?? null;
                $version['previous'] = null;
                if ($previous !== null && str_contains($version['text'], '[...]')) {
                    unset($previous['previous']);
                    $version['previous'] = $previous;
                    if ($version['title'] === '') {
                        $version['title'] = $previous['title'];
                    }
                }
                $articles[$number] = $version;
            }
            foreach ($document['revoked'] ?? array() as $number) {
                $number = ArticleParser::normalizeNumber($number);
                if (isset($articles[$number])) {
                    $articles[$number]['revoked'] = true;
                    $articles[$number]['document'] = $source;
                }
            }
        }
        uksort($articles, static function ($a, $b) {
            return self::sortKey($a) <=> self::sortKey($b);
        });

        return $articles;
    }

    /**
     * Some articles in force, as a text for the AI assistant.
     *
     * @param list<string> $numbers the article numbers
     * @param null|string  $date    Y-m-d, today by default
     *
     * @return string the articles, with their source
     */
    public function text(array $numbers, $date = null)
    {
        $inForce = $this->inForce($date);
        $texts = array();
        foreach ($numbers as $number) {
            $article = $inForce[ArticleParser::normalizeNumber($number)] ?? null;
            if ($article === null) {
                continue;
            }
            $heading = 'Artigo '.$article['label'].($article['title'] !== '' ? ' — '.$article['title'] : '')
                .' ('.$article['document']['title'].', '.$article['document']['date'].')';
            if ($article['revoked']) {
                $texts[] = $heading."\nRevogado.";

                continue;
            }
            $text = $heading."\n".$article['text'];
            if ($article['previous']) {
                $text .= "\n[...] = texto anterior mantido ("
                    .$article['previous']['document']['title'].', '.$article['previous']['document']['date']."):\n"
                    .$article['previous']['text'];
            }
            $texts[] = $text;
        }

        return implode("\n\n", $texts);
    }

    /**
     * @param string $number normalized article number, e.g. "67-B"
     *
     * @return array{0: int, 1: string}
     */
    protected static function sortKey($number)
    {
        $parts = explode('-', $number, 2);

        return array((int) $parts[0], $parts[1] ?? '');
    }
}
