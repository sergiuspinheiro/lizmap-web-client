<?php

/**
 * Split the text of any document (report, notes, inventory sheet...) into
 * numbered sections of a limited length, starting at its headings when
 * they can be found.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Documents;

class SectionParser
{
    /**
     * Split a text into sections.
     *
     * @param string $text      the text
     * @param int    $maxLength maximum length of a section
     *
     * @return list<array{number: string, label: string, title: string, text: string, chapter: string, section: string}>
     */
    public static function parse($text, $maxLength = 1500)
    {
        $lines = preg_split('/\r\n|\r|\n/', (string) $text);
        $sections = array();
        $title = '';
        $body = array();
        $length = 0;
        $previousEnds = true;

        $close = static function () use (&$sections, &$title, &$body, &$length) {
            $text = trim(implode("\n", $body));
            $text = preg_replace("/(\\p{L})-\n(\\p{Ll})/u", '$1$2', $text);
            if ($text !== '' || $title !== '') {
                $number = (string) (count($sections) + 1);
                $sections[] = array(
                    'number' => $number,
                    'label' => '§'.$number,
                    'title' => $title,
                    'text' => $text,
                    'chapter' => '',
                    'section' => '',
                );
            }
            $body = array();
            $length = 0;
        };

        foreach ($lines as $line) {
            $line = trim(preg_replace('/^#+\s*/', '', $line, 1, $isMarkdownHeading) ?? $line);
            if ($line === '') {
                $previousEnds = true;

                continue;
            }
            // A heading: a short line, without final punctuation, after the end of a paragraph
            $isHeading = $isMarkdownHeading > 0 || ($previousEnds && mb_strlen($line) <= 80
                && preg_match('/^[\p{Lu}\d]/u', $line) && !preg_match('/[.,;:!?]$/u', $line)
                && !preg_match('/^\d+\s*[—-]/u', $line));
            if ($isHeading && ($length > 0 || $title === '')) {
                if ($length > 0) {
                    $close();
                }
                $title = $line;
                $previousEnds = true;

                continue;
            }
            if ($length + mb_strlen($line) > $maxLength && $length > 0) {
                $close();
            }
            $body[] = $line;
            $length += mb_strlen($line) + 1;
            $previousEnds = (bool) preg_match('/[.!?:;]$/u', $line);
        }
        $close();

        return $sections;
    }
}
