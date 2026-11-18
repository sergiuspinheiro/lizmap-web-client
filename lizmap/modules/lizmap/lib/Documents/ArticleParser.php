<?php

/**
 * Split the text of a regulation (e.g. of a PDM published in the Diário da República)
 * into articles: number, title, text, chapter and section.
 *
 * The automatic split is a first draft, to be checked in the administration.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Documents;

class ArticleParser
{
    /** Article heading, e.g. "Artigo 67.º-B", "Artigo 23.o", "ARTIGO 5.º" */
    protected const ARTICLE = '/^\s*artigo\s+(\d+)\s*\.?\s*[ºo°]?\s*(?:-\s*([A-Z]))?\s*\.?\s*$/iu';

    /** Chapter or section heading */
    protected const PART = '/^\s*(cap[íi]tulo|sec[çc][ãa]o|subsec[çc][ãa]o|t[íi]tulo)\s+([IVXLC\d]+(?:\s*-\s*[A-Z])?)\s*$/iu';

    /** Lines of the page layout: headers, footers, page numbers */
    protected const LAYOUT = array(
        '/^\s*di[áa]rio da rep[úu]blica\b/iu',
        '/^\s*n\.\s*[ºo°]\s*\d+\s*[—-]\s*\d/iu',
        '/^\s*\d{1,5}\s*$/',
        '/^\s*p[áa]g\.\s*\d+\s*$/iu',
        '/^\s*parte\s+[a-z]\s*$/iu',
        '/^\s*[ivx]+\s+s[ée]rie(\s*-\s*[a-z])?\s*$/iu',
        '/^\s*n\.\s*[ºo°]\s*\d+\s*$/iu',
        '/^\s*\d{1,2}\s+de\s+\p{L}+\s+de\s+\d{4}\s*$/iu',
    );

    /** Lines ending an article, e.g. in an amendment "São aditados os seguintes artigos" */
    protected const CLOSE = array(
        '/^\s*(s[ãa]o|[ée])\s+(aditad|alterad|revogad|republicad)[oa]s?\b/iu',
        '/^\s*\(?republica[çc][ãa]o\)?\s*$/iu',
    );

    /** Lines starting another publication: the regulation ends there */
    protected const END = array(
        '/^\s*\d{9}\s*$/',
        '/^\s*MUNIC[ÍI]PIO D[AEO]S?\s+[\p{Lu}\s-]+$/u',
        '/^\s*(aviso|edital|despacho|declara[çc][ãa]o|resolu[çc][ãa]o(\s+do\s+conselho\s+de\s+ministros)?|portaria|decreto(-lei|\s+regulamentar)?)(\s*\(extrato\))?\s+n\.\s*[ºo°]\s*[\d\/-]+\s*:?\s*$/iu',
        '/^\s*identificadores das imagens\b/iu',
    );

    /** Revoked articles, e.g. "É revogado o artigo 64.º", "São revogados os artigos 12.º e 13.º" */
    protected const REVOKED = '/(?:[ée]|s[ãa]o)\s+revogad[oa]s?\s+(?:o|a|os|as)\s+(?:artigos?|n\.\s*[ºo°]s?)\s+([^.;]*(?:\.\s*[ºo°][^.;]*)*)/iu';

    /**
     * Normalize an article number: "67.º-B" → "67-B", "23.o" → "23".
     *
     * @param string $number the number
     *
     * @return string
     */
    public static function normalizeNumber($number)
    {
        if (preg_match('/(\d+)\s*\.?\s*[ºo°]?\s*(?:-\s*([A-Z]))?/u', (string) $number, $match)) {
            return $match[1].(isset($match[2]) && $match[2] !== '' ? '-'.strtoupper($match[2]) : '');
        }

        return trim((string) $number);
    }

    /**
     * Label of a normalized article number: "67-B" → "67.º-B".
     *
     * @param string $number the normalized number
     *
     * @return string
     */
    public static function label($number)
    {
        $parts = explode('-', (string) $number, 2);

        return $parts[0].'.º'.(isset($parts[1]) ? '-'.$parts[1] : '');
    }

    /**
     * Split a text into articles.
     *
     * When an article is found twice (an amendment, then the republication of the
     * whole regulation in the same document), the last one is kept.
     *
     * @param string $text the text of the document
     *
     * @return array{articles: list<array{number: string, label: string, title: string, text: string, chapter: string, section: string}>, revoked: list<string>}
     */
    public static function parse($text)
    {
        $lines = preg_split('/\r\n|\r|\n/', (string) $text);
        // Parts of the document separated by other publications: the regulation
        // is the part with the most articles
        $segments = array();
        $articles = array();
        $current = null;
        $chapter = '';
        $section = '';
        $pendingPart = null;
        $ended = false;

        $close = static function () use (&$current, &$articles) {
            if ($current === null) {
                return;
            }
            $body = trim(preg_replace("/[ \t]+/", ' ', implode("\n", $current['lines'])));
            // Words cut at the end of a line: "infra-\nestruturas" → "infra-estruturas"
            $body = preg_replace("/(\\p{L})-\n(\\p{Ll})/u", '$1$2', $body);
            // Hyphen of the Diário da República: "ferro -velho" → "ferro-velho"
            $body = preg_replace('/(\\p{L}) -(\\p{L})/u', '$1-$2', $body);
            unset($current['lines']);
            $current['text'] = $body;
            unset($articles[$current['number']]);
            $articles[$current['number']] = $current;
            $current = null;
        };

        $count = count($lines);
        for ($i = 0; $i < $count; ++$i) {
            $line = trim($lines[$i]);
            if ($line === '' || self::matchesAny($line, self::LAYOUT)) {
                continue;
            }
            if (preg_match(self::ARTICLE, $line, $match)) {
                $close();
                $ended = false;
                $number = $match[1].(isset($match[2]) && $match[2] !== '' ? '-'.strtoupper($match[2]) : '');
                // The title is the next line, if it is not the start of the text
                $title = '';
                for ($j = $i + 1; $j < $count; ++$j) {
                    $next = trim($lines[$j]);
                    if ($next === '' || self::matchesAny($next, self::LAYOUT)) {
                        continue;
                    }
                    if (mb_strlen($next) <= 120 && !preg_match('/^(\d+\s*[—-]|[a-z]\)|\[)/u', $next)
                        && !preg_match(self::ARTICLE, $next) && !preg_match('/[.;:]$/u', $next)) {
                        $title = $next;
                        $i = $j;
                    }

                    break;
                }
                $current = array(
                    'number' => $number,
                    'label' => self::label($number),
                    'title' => preg_replace('/(\p{L}) -(\p{L})/u', '$1-$2', $title),
                    'chapter' => $chapter,
                    'section' => $section,
                    'lines' => array(),
                );

                continue;
            }
            if (preg_match(self::PART, $line, $match)) {
                // The name of the part is on the next line
                $name = '';
                for ($j = $i + 1; $j < $count; ++$j) {
                    $next = trim($lines[$j]);
                    if ($next !== '' && !self::matchesAny($next, self::LAYOUT)) {
                        if (!preg_match(self::ARTICLE, $next) && !preg_match(self::PART, $next)) {
                            $name = $next;
                            $i = $j;
                        }

                        break;
                    }
                }
                $match[2] = preg_replace('/\s+-\s*/', '-', $match[2]);
                $name = preg_replace('/(\p{L}) -(\p{L})/u', '$1-$2', $name);
                $part = mb_strtoupper(mb_substr($match[1], 0, 1)).mb_strtolower(mb_substr($match[1], 1)).' '.$match[2].($name !== '' ? ' — '.$name : '');
                if (preg_match('/^cap|^t[íi]t/iu', $match[1])) {
                    $chapter = $part;
                    $section = '';
                } else {
                    $section = $part;
                }
                $close();

                continue;
            }
            if (self::matchesAny($line, self::CLOSE)) {
                $close();

                continue;
            }
            if (self::matchesAny($line, self::END)) {
                $close();
                if ($articles) {
                    $segments[] = $articles;
                    $articles = array();
                }
                $ended = true;

                continue;
            }
            if ($current !== null && !$ended) {
                $current['lines'][] = $line;
            }
        }
        $close();
        $segments[] = $articles;
        usort($segments, static function ($a, $b) {
            return count($b) <=> count($a);
        });

        return array(
            'articles' => array_values($segments[0]),
            'revoked' => self::revoked($text),
        );
    }

    /**
     * The articles revoked by a document.
     *
     * @param string $text the text of the document
     *
     * @return list<string> the normalized numbers
     */
    public static function revoked($text)
    {
        $text = preg_replace('/\s+/u', ' ', (string) $text);
        $numbers = array();
        if (preg_match_all(self::REVOKED, $text, $matches)) {
            foreach ($matches[1] as $list) {
                if (preg_match_all('/(\d+)\s*\.?\s*[ºo°](?:\s*-\s*([A-Z])\b)?/u', $list, $found, PREG_SET_ORDER)) {
                    foreach ($found as $item) {
                        $numbers[] = $item[1].(isset($item[2]) && $item[2] !== '' ? '-'.$item[2] : '');
                    }
                }
            }
        }

        return array_values(array_unique($numbers));
    }

    /**
     * @param string       $line     the line
     * @param list<string> $patterns regular expressions
     *
     * @return bool
     */
    protected static function matchesAny($line, array $patterns)
    {
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $line)) {
                return true;
            }
        }

        return false;
    }
}
