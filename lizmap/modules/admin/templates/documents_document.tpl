{jmessage_bootstrap}

<p><a href="{jurl 'admin~documents:collection', array('id' => $collection['id'])}">← {$collection['title']|eschtml}</a></p>
{if $document}
<h1>{$document['title']|eschtml}</h1>
{if $canUpdate}
<form method="post" action="{jurl 'admin~documents:saveDocument'}" class="row g-2 mb-3">
  <input type="hidden" name="token" value="{$token}">
  <input type="hidden" name="collection" value="{$collection['id']}">
  <input type="hidden" name="document" value="{$document['id']}">
  <div class="col-md-6"><input name="title" class="form-control" value="{$document['title']|eschtml}" maxlength="200" required></div>
  <div class="col-md-3"><input type="date" name="date" class="form-control" value="{$document['date']}" required></div>
  <div class="col-md-3"><button type="submit" class="btn btn-primary">{@admin~documents.save@}</button></div>
</form>
{/if}
<p>{@admin~documents.parts.help@}</p>
{else}
<h1>{@admin~documents.inforce@}</h1>
<form method="get" action="{jurl 'admin~documents:document'}" class="row g-2 mb-3">
  <input type="hidden" name="collection" value="{$collection['id']}">
  <div class="col-md-3"><input type="date" name="date" class="form-control" value="{$date}"></div>
  <div class="col-md-3"><button type="submit" class="btn">{@admin~documents.inforce.date@}</button></div>
</form>
{/if}

{foreach $parts as $part}
<div class="card mb-3" id="part-{$part['number']|eschtml}">
  <div class="card-header">
    <strong>{$part['heading']|eschtml}</strong>
    {if $part['title']} — {$part['title']|eschtml}{/if}
    {if $part['chapter'] || $part['section']}<br><small class="text-muted">{$part['chapter']|eschtml}{if $part['section']} / {$part['section']|eschtml}{/if}</small>{/if}
    {if !$document && isset($part['document'])}<br><small>{$part['document']['title']|eschtml} ({$part['document']['date']}){if $part['revoked']} — <strong>{@admin~documents.revoked@}</strong>{/if}{if $part['previous']} — {@admin~documents.previous@} {$part['previous']['document']['title']|eschtml}{/if}</small>{/if}
  </div>
  <div class="card-body">
  {if $document && $canUpdate}
    <form method="post" action="{jurl 'admin~documents:savePart'}">
      <input type="hidden" name="token" value="{$token}">
      <input type="hidden" name="collection" value="{$collection['id']}">
      <input type="hidden" name="document" value="{$document['id']}">
      <input type="hidden" name="number" value="{$part['number']|eschtml}">
      <input name="title" class="form-control mb-2" value="{$part['title']|eschtml}" maxlength="300">
      <textarea name="text" class="form-control mb-2" rows="6">{$part['text']|eschtml}</textarea>
      <button type="submit" class="btn btn-sm btn-primary">{@admin~documents.save@}</button>
    </form>
  {else}
    <pre style="white-space: pre-wrap; font-family: inherit;">{$part['text']|eschtml}</pre>
  {/if}
  </div>
</div>
{foreachelse}
<p>{@admin~documents.parts.none@}</p>
{/foreach}
