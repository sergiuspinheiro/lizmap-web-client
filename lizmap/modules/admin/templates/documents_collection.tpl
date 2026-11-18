{jmessage_bootstrap}

<p><a href="{jurl 'admin~documents:index'}">← {@admin~documents.h1@}</a></p>
<h1>{$collection['title']|eschtml}</h1>
<p>{if $collection['type'] == 'regulation'}{@admin~documents.type.regulation@}{else}{@admin~documents.type.documents@}{/if}
  {if $collection['description']} — {$collection['description']|eschtml}{/if}</p>

<h2>{@admin~documents.documents@}</h2>
{if $collection['type'] == 'regulation'}<p>{@admin~documents.regulation.help@}
  <a href="{jurl 'admin~documents:document', array('collection' => $collection['id'])}">{@admin~documents.inforce@}</a></p>{/if}
<table class="table">
  <thead>
    <tr>
      <th>{@admin~documents.document.title@}</th>
      <th>{@admin~documents.document.date@}</th>
      <th>{@admin~documents.document.parts@}</th>
      <th>{@admin~documents.document.file@}</th>
      {if $canUpdate}<th></th>{/if}
    </tr>
  </thead>
  <tbody>
  {if count($collection['documents'])}{foreach $collection['documents'] as $document}
    <tr>
      <td><a href="{jurl 'admin~documents:document', array('collection' => $collection['id'], 'document' => $document['id'])}">{$document['title']|eschtml}</a></td>
      <td>{$document['date']}</td>
      <td>{$document['partCount']} {if $document['kind'] == 'articles'}{@admin~documents.kind.articles@}{else}{@admin~documents.kind.sections@}{/if}
        {if $document['revokedText']}<br><small>{@admin~documents.revoked@} {$document['revokedText']|eschtml}</small>{/if}</td>
      <td><a href="{jurl 'admin~documents:file', array('collection' => $collection['id'], 'document' => $document['id'])}" target="_blank">{$document['fileName']|eschtml}</a></td>
      {if $canUpdate}<td>
        <form method="post" action="{jurl 'admin~documents:deleteDocument'}" onsubmit="return confirm('{@admin~documents.confirm@}');">
          <input type="hidden" name="token" value="{$token}">
          <input type="hidden" name="collection" value="{$collection['id']}">
          <input type="hidden" name="document" value="{$document['id']}">
          <button type="submit" class="btn btn-sm btn-outline-danger">{@admin~documents.delete@}</button>
        </form>
      </td>{/if}
    </tr>
  {/foreach}{else}
    <tr><td colspan="5">{@admin~documents.document.none@}</td></tr>
  {/if}
  </tbody>
</table>

{if $canUpdate}
<h3>{@admin~documents.document.new@}</h3>
<form method="post" action="{jurl 'admin~documents:upload'}" enctype="multipart/form-data" class="mb-4">
  <input type="hidden" name="token" value="{$token}">
  <input type="hidden" name="collection" value="{$collection['id']}">
  <table class="table services-table">
    <tr><th><label for="doc-file">{@admin~documents.document.file@}</label></th>
      <td><input id="doc-file" type="file" name="file" class="form-control" accept=".pdf,.txt,.md" required>
      <div class="form-text">{@admin~documents.document.file.help@}</div></td></tr>
    <tr><th><label for="doc-title">{@admin~documents.document.title@}</label></th>
      <td><input id="doc-title" name="title" class="form-control" maxlength="200" placeholder="{@admin~documents.document.title.placeholder@}"></td></tr>
    <tr><th><label for="doc-date">{@admin~documents.document.date@}</label></th>
      <td><input id="doc-date" type="date" name="date" class="form-control" required>
      <div class="form-text">{@admin~documents.document.date.help@}</div></td></tr>
  </table>
  <button type="submit" class="btn btn-primary">{@admin~documents.upload@}</button>
</form>
{/if}

<h2>{@admin~documents.links@}</h2>
<p>{@admin~documents.links.help@}</p>
<table class="table">
  <thead>
    <tr>
      <th>{@admin~documents.link.map@}</th>
      <th>{@admin~documents.link.layer@}</th>
      <th>{@admin~documents.link.features@}</th>
      <th>{@admin~documents.link.parts@}</th>
      <th>{@admin~documents.link.note@}</th>
      {if $canUpdate}<th></th>{/if}
    </tr>
  </thead>
  <tbody>
  {if count($links)}{foreach $links as $link}
    <tr>
      <td>{$link['repository']|eschtml}~{$link['project']|eschtml}</td>
      <td>{if $link['layer']}{$link['layer']|eschtml}{else}<em>{@admin~documents.link.alllayers@}</em>{/if}</td>
      <td>{if $link['value']}{if $link['field']}{$link['field']|eschtml} = {/if}{$link['value']|eschtml}{else}<em>{@admin~documents.link.all@}</em>{/if}</td>
      <td>{if $link['partsText']}{$link['partsText']|eschtml}{else}<em>{@admin~documents.link.allparts@}</em>{/if}</td>
      <td>{$link['note']|eschtml}</td>
      {if $canUpdate}<td>
        <form method="post" action="{jurl 'admin~documents:deleteLink'}" onsubmit="return confirm('{@admin~documents.confirm@}');">
          <input type="hidden" name="token" value="{$token}">
          <input type="hidden" name="collection" value="{$collection['id']}">
          <input type="hidden" name="link" value="{$link['id']}">
          <button type="submit" class="btn btn-sm btn-outline-danger">{@admin~documents.delete@}</button>
        </form>
      </td>{/if}
    </tr>
  {/foreach}{else}
    <tr><td colspan="6">{@admin~documents.link.none@}</td></tr>
  {/if}
  </tbody>
</table>

{if $canUpdate}
<h3>{@admin~documents.link.new@}</h3>
<form method="post" action="{jurl 'admin~documents:addLink'}" class="mb-4" id="documents-link-form" data-layers-url="{$layersUrl}">
  <input type="hidden" name="token" value="{$token}">
  <input type="hidden" name="collection" value="{$collection['id']}">
  <table class="table services-table">
    <tr><th><label for="link-map">{@admin~documents.link.map@}</label></th>
      <td><select id="link-map" name="map" class="form-select" required>
        <option value=""></option>
        {foreach $maps as $map}<option value="{$map['id']|eschtml}">{$map['title']|eschtml}</option>{/foreach}
      </select></td></tr>
    <tr><th><label for="link-layer">{@admin~documents.link.layer@}</label></th>
      <td><input id="link-layer" name="layer" class="form-control" list="link-layers" maxlength="200">
      <datalist id="link-layers"></datalist>
      <div class="form-text">{@admin~documents.link.layer.help@}</div></td></tr>
    <tr><th><label for="link-field">{@admin~documents.link.field@}</label></th>
      <td><input id="link-field" name="field" class="form-control" maxlength="200">
      <div class="form-text">{@admin~documents.link.field.help@}</div></td></tr>
    <tr><th><label for="link-value">{@admin~documents.link.value@}</label></th>
      <td><input id="link-value" name="value" class="form-control" maxlength="500">
      <div class="form-text">{@admin~documents.link.value.help@}</div></td></tr>
    <tr><th><label for="link-parts">{@admin~documents.link.parts@}</label></th>
      <td><input id="link-parts" name="parts" class="form-control" maxlength="2000" placeholder="67-A, 67-B">
      <div class="form-text">{@admin~documents.link.parts.help@}</div></td></tr>
    <tr><th><label for="link-note">{@admin~documents.link.note@}</label></th>
      <td><textarea id="link-note" name="note" class="form-control" rows="2" maxlength="2000"></textarea>
      <div class="form-text">{@admin~documents.link.note.help@}</div></td></tr>
  </table>
  <button type="submit" class="btn btn-primary">{@admin~documents.link.add@}</button>
</form>
<script>
{literal}
(function () {
    const form = document.getElementById('documents-link-form');
    const select = document.getElementById('link-map');
    const list = document.getElementById('link-layers');
    select.addEventListener('change', async () => {
        list.replaceChildren();
        const [repository, project] = select.value.split('~');
        if (!project) {
            return;
        }
        try {
            const url = form.dataset.layersUrl + (form.dataset.layersUrl.includes('?') ? '&' : '?')
                + new URLSearchParams({ repository, project });
            const response = await fetch(url);
            if (!response.ok) {
                return;
            }
            const data = await response.json();
            for (const layer of data.layers || []) {
                const option = document.createElement('option');
                option.value = layer.name;
                option.label = layer.title;
                list.append(option);
            }
        } catch (error) {
            console.error(error);
        }
    });
})();
{/literal}
</script>

<h2>{@admin~documents.collection.delete@}</h2>
<form method="post" action="{jurl 'admin~documents:deleteCollection'}" onsubmit="return confirm('{@admin~documents.confirm@}');">
  <input type="hidden" name="token" value="{$token}">
  <input type="hidden" name="id" value="{$collection['id']}">
  <button type="submit" class="btn btn-outline-danger">{@admin~documents.collection.delete@}</button>
</form>
{/if}
