<?php

/**
 * Text of a PDF document, in reading order, also for documents in two columns
 * such as the Diário da República.
 *
 * Uses pdftotext (poppler-utils) with the position of the text blocks.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Documents;

class PdfText
{
    /**
     * Is pdftotext installed.
     *
     * @param string $command the pdftotext command
     *
     * @return bool
     */
    public static function isAvailable($command = 'pdftotext')
    {
        // exec() may be disabled in php.ini
        if (!function_exists('exec')) {
            return false;
        }
        $output = array();
        $code = 1;
        @exec(escapeshellcmd($command).' -v 2>&1', $output, $code);

        return $code === 0 || $code === 99;
    }

    /**
     * Read the text of a PDF file.
     *
     * @param string $path    the PDF file
     * @param string $command the pdftotext command
     *
     * @return string the text, one line by line of the document
     *
     * @throws \RuntimeException if the file cannot be read
     */
    public static function fromFile($path, $command = 'pdftotext')
    {
        if (!function_exists('exec')) {
            throw new \RuntimeException('The text of a PDF file cannot be read: exec() is disabled in php.ini');
        }
        $output = array();
        $code = 1;
        exec(escapeshellcmd($command).' -enc UTF-8 -bbox-layout '.escapeshellarg($path).' - 2>/dev/null', $output, $code);
        if ($code !== 0 || count($output) === 0) {
            throw new \RuntimeException('The text of the PDF file cannot be read (is pdftotext installed?)');
        }

        return self::fromBboxLayout(implode("\n", $output));
    }

    /**
     * Text of the XHTML given by pdftotext -bbox-layout: in each page, the blocks
     * spanning the page first, then the blocks of the left column, then of the right column.
     *
     * @param string $xhtml the pdftotext output
     *
     * @return string the text
     */
    public static function fromBboxLayout($xhtml)
    {
        $document = new \DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $document->loadXML(preg_replace('/<!DOCTYPE[^>]*>/', '', $xhtml), LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $text = array();
        foreach ($document->getElementsByTagName('page') as $page) {
            $middle = (float) $page->getAttribute('width') / 2;
            $blocks = array();
            foreach ($page->getElementsByTagName('block') as $index => $block) {
                $xMin = (float) $block->getAttribute('xMin');
                $xMax = (float) $block->getAttribute('xMax');
                if ($xMax <= $middle + 10) {
                    $column = 1;
                } elseif ($xMin >= $middle - 10) {
                    $column = 2;
                } else {
                    $column = 0;
                }
                $blockLines = array();
                foreach ($block->getElementsByTagName('line') as $line) {
                    $words = array();
                    foreach ($line->getElementsByTagName('word') as $word) {
                        $words[] = $word->textContent;
                    }
                    $blockLines[] = implode(' ', $words);
                }
                $blocks[] = array($column, (float) $block->getAttribute('yMin'), $index, $blockLines);
            }
            // A page in one column: blocks sorted by position only
            $counts = array(0, 0, 0);
            foreach ($blocks as $block) {
                $counts[$block[0]] += count($block[3]);
            }
            $total = array_sum($counts);
            if ($total > 0 && min($counts[1], $counts[2]) < 0.2 * $total) {
                foreach ($blocks as &$block) {
                    $block[0] = 0;
                }
                unset($block);
            }
            usort($blocks, static function ($a, $b) {
                return array($a[0], $a[1], $a[2]) <=> array($b[0], $b[1], $b[2]);
            });
            foreach ($blocks as $block) {
                array_push($text, ...$block[3]);
            }
        }

        return implode("\n", $text);
    }
}
