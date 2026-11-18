<?php

/**
 * The reference documents linked to a layer, as a text for the AI assistant:
 * the links of the layer apply to all its features, or to the features having
 * a value found in the analysed features or in the question.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Documents;

use Lizmap\Ai\Assistant;
use Lizmap\Ai\FeatureLocator;

class DocumentContext
{
    /** @var DocumentStore */
    protected $store;

    /**
     * @param DocumentStore $store the documents
     */
    public function __construct(DocumentStore $store)
    {
        $this->store = $store;
    }

    /**
     * The text of the documents linked to a layer.
     *
     * @param string     $repository the repository key
     * @param string     $project    the project key
     * @param string     $layer      the layer name
     * @param string     $question   the user question
     * @param null|array $rows       the analysed features: list of properties
     * @param int        $maxLength  maximum length of the text
     *
     * @return array{text: string, sources: list<array{collection: string, label: string, title: string}>}
     */
    public function forLayer($repository, $project, $layer, $question, $rows, $maxLength = 8000)
    {
        $normalizedQuestion = ' '.FeatureLocator::normalize($question).' ';
        $candidates = array();
        foreach ($this->store->linksOf($repository, $project, $layer) as $order => $link) {
            if (!$this->applies($link, $normalizedQuestion, $rows)) {
                continue;
            }
            $parts = $this->store->parts($link['collection']);
            $collection = $this->store->collections()[$link['collection']] ?? array('title' => $link['collection']);
            $chosen = array();
            if ($link['parts']) {
                foreach ($link['parts'] as $number) {
                    if (isset($parts[$number])) {
                        $chosen[] = $parts[$number];
                    }
                }
            } else {
                $chosen = array_values($parts);
            }
            foreach ($chosen as $part) {
                $candidates[] = array(
                    'link' => $link,
                    'collection' => $collection,
                    'part' => $part,
                    // Parts chosen by the administrator and specific to a value come first
                    'priority' => ($link['parts'] ? 2 : 0) + ($link['value'] !== '' ? 1 : 0),
                    'score' => 0,
                    'order' => count($candidates),
                );
            }
        }
        if (count($candidates) === 0) {
            return array('text' => '', 'sources' => array());
        }

        // Then the parts sharing the most words with the question
        $scores = Assistant::keywordScores($question, array_map(static function ($candidate) {
            $part = $candidate['part'];

            return array(
                'title' => $part['title'].' '.$part['section'],
                'abstract' => $part['text'],
                'keywords' => '',
                'map' => '',
                'type' => '',
            );
        }, $candidates));
        foreach ($scores as $index => $score) {
            $candidates[$index]['score'] = $score;
        }
        usort($candidates, static function ($a, $b) {
            return array($b['priority'], $b['score'], $a['order']) <=> array($a['priority'], $a['score'], $b['order']);
        });

        $texts = array();
        $sources = array();
        $length = 0;
        $seen = array();
        foreach ($candidates as $candidate) {
            $part = $candidate['part'];
            $key = $candidate['link']['collection'].'|'.$part['number'];
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $text = $this->partText($candidate['collection']['title'], $candidate['link'], $part);
            if ($length + mb_strlen($text) > $maxLength) {
                if ($length === 0) {
                    $text = mb_substr($text, 0, $maxLength).'…';
                } else {
                    continue;
                }
            }
            $texts[] = $text;
            $length += mb_strlen($text) + 2;
            $sources[] = array(
                'collection' => $candidate['collection']['title'],
                'label' => $part['label'],
                'title' => $part['title'],
            );
        }

        return array('text' => implode("\n\n", $texts), 'sources' => $sources);
    }

    /**
     * Does a link apply: to all the features, or a value found in the features or in the question.
     *
     * @param array      $link               the link
     * @param string     $normalizedQuestion the question, normalized, with spaces around
     * @param null|array $rows               the analysed features
     *
     * @return bool
     */
    protected function applies(array $link, $normalizedQuestion, $rows)
    {
        if ($link['value'] === '') {
            return true;
        }
        $value = FeatureLocator::normalize($link['value']);
        if ($value !== '' && str_contains($normalizedQuestion, ' '.$value.' ')) {
            return true;
        }
        foreach (is_array($rows) ? $rows : array() as $row) {
            foreach ($link['field'] !== '' ? array($row[$link['field']] ?? null) : (array) $row as $rowValue) {
                if (is_scalar($rowValue) && FeatureLocator::normalize($rowValue) === $value) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * @param string $collection the collection title
     * @param array  $link       the link
     * @param array  $part       the article or section
     *
     * @return string the text of the part, with its source
     */
    protected function partText($collection, array $link, array $part)
    {
        $heading = $collection.' — '
            .(preg_match('/^\d/', $part['label']) ? 'Artigo '.$part['label'] : $part['label'])
            .($part['title'] !== '' ? ' — '.$part['title'] : '')
            .' ('.$part['document']['title'].', '.$part['document']['date'].')';
        $applies = $link['value'] !== ''
            ? "\n(aplica-se a ".($link['field'] !== '' ? $link['field'].' = ' : '').$link['value'].')'
            : '';
        if ($link['note'] !== '') {
            $applies .= "\n(nota: ".$link['note'].')';
        }
        if ($part['revoked']) {
            return $heading.$applies."\nRevogado.";
        }
        $text = $heading.$applies."\n".$part['text'];
        if (!empty($part['previous'])) {
            $text .= "\n[...] = texto anterior mantido ("
                .$part['previous']['document']['title'].', '.$part['previous']['document']['date']."):\n"
                .$part['previous']['text'];
        }

        return $text;
    }
}
