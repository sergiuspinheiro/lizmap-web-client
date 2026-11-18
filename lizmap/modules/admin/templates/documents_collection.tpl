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
      {if $canUpdate}<td class="text-nowrap">
        <button type="button" class="btn btn-sm btn-outline-secondary documents-link-edit" data-link="{$link['json']|eschtml}">{@admin~documents.link.edit@}</button>
        <form method="post" action="{jurl 'admin~documents:deleteLink'}" class="d-inline" onsubmit="return confirm('{@admin~documents.confirm@}');">
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
<h3 id="link-form-title" data-new="{@admin~documents.link.new@}" data-edit="{@admin~documents.link.editing@}">{@admin~documents.link.new@}</h3>
<form method="post" action="{jurl 'admin~documents:addLink'}" class="mb-4" id="documents-link-form" data-layers-url="{$layersUrl}" data-values-url="{$valuesUrl}" data-values-label="{@admin~documents.link.values.count@}">
  <input type="hidden" name="token" value="{$token}">
  <input type="hidden" name="collection" value="{$collection['id']}">
  <input type="hidden" name="link" id="link-id" value="">
  <table class="table services-table">
    <tr><th><label for="link-map">{@admin~documents.link.map@}</label></th>
      <td><select id="link-map" name="map" class="form-select" required>
        <option value=""></option>
        {foreach $maps as $map}<option value="{$map['id']|eschtml}">{$map['title']|eschtml}</option>{/foreach}
      </select></td></tr>
    <tr><th><label for="link-layer">{@admin~documents.link.layer@}</label></th>
      <td><input id="link-layer" name="layer" class="form-control" list="link-layers" maxlength="200" autocomplete="off">
      <datalist id="link-layers"></datalist>
      <div class="form-text">{@admin~documents.link.layer.help@}</div></td></tr>
    <tr><th><label for="link-field">{@admin~documents.link.field@}</label></th>
      <td><input id="link-field" name="field" class="form-control" list="link-fields" maxlength="200" autocomplete="off">
      <datalist id="link-fields"></datalist>
      <div class="form-text">{@admin~documents.link.field.help@} <span id="link-values-status"></span></div></td></tr>
    <tr><th><label for="link-value">{@admin~documents.link.value@}</label></th>
      <td><input id="link-value" name="value" class="form-control" list="link-values" maxlength="500" autocomplete="off">
      <datalist id="link-values"></datalist>
      <div class="form-text">{@admin~documents.link.value.help@}</div></td></tr>
    <tr><th><label for="link-parts-filter">{@admin~documents.link.parts@}</label></th>
      <td>
      {if count($parts)}
      <input id="link-parts-filter" type="search" class="form-control mb-1" placeholder="{@admin~documents.link.parts.search@}" autocomplete="off">
      <div id="link-parts" class="border rounded p-2" style="max-height: 16rem; overflow-y: auto;">
        {foreach $parts as $part}<div class="form-check" data-text="{$part['label']|eschtml}">
          <input class="form-check-input" type="checkbox" name="parts[]" value="{$part['number']|eschtml}" id="link-part-{$part['number']|eschtml}">
          <label class="form-check-label" for="link-part-{$part['number']|eschtml}">{$part['label']|eschtml}</label>
        </div>{/foreach}
      </div>
      <div class="form-text"><span id="link-parts-count">0</span> {@admin~documents.link.parts.selected@} {@admin~documents.link.parts.help@}</div>
      {/if}
      <input id="link-other-parts" name="otherParts" class="form-control mt-1" maxlength="2000" placeholder="{@admin~documents.link.parts.other@}">
      </td></tr>
    <tr><th><label for="link-note">{@admin~documents.link.note@}</label></th>
      <td><textarea id="link-note" name="note" class="form-control" rows="2" maxlength="2000"></textarea>
      <div class="form-text">{@admin~documents.link.note.help@}</div></td></tr>
  </table>
  <button type="submit" class="btn btn-primary" id="link-submit" data-new="{@admin~documents.link.add@}" data-edit="{@admin~documents.link.save@}">{@admin~documents.link.add@}</button>
  <button type="button" class="btn btn-outline-secondary" id="link-cancel" hidden>{@admin~documents.link.cancel@}</button>
</form>
<script>
{literal}
(function () {
    const form = document.getElementById('documents-link-form');
    const select = document.getElementById('link-map');
    const layerInput = document.getElementById('link-layer');
    const fieldInput = document.getElementById('link-field');
    const layerList = document.getElementById('link-layers');
    const fieldList = document.getElementById('link-fields');
    const valueList = document.getElementById('link-values');
    const status = document.getElementById('link-values-status');
    let fields = [];
    let layers = [];

    const withParams = (url, params) => url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params);
    const fill = (list, items) => {
        list.replaceChildren(...items.map(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            if (label && label !== value) {
                option.label = label;
            }
            return option;
        }));
    };
    const showValues = () => {
        const field = fields.find(item => item.name === fieldInput.value);
        if (field) {
            fill(valueList, field.values.map(value => [value]));
        } else {
            // Any field: every value, once
            const values = new Set();
            fields.forEach(item => item.values.forEach(value => values.add(value)));
            fill(valueList, [...values].slice(0, 2000).map(value => [value]));
        }
    };

    const loadLayers = async () => {
        requested = null;
        layers = [];
        fields = [];
        fill(layerList, []);
        fill(fieldList, []);
        fill(valueList, []);
        if (!select.value) {
            return;
        }
        try {
            const response = await fetch(withParams(form.dataset.layersUrl, { map: select.value }));
            if (response.ok) {
                layers = (await response.json()).layers || [];
                fill(layerList, layers.map(layer => [layer.name, layer.title]));
            }
        } catch (error) {
            console.error(error);
        }
    };
    select.addEventListener('change', loadLayers);

    let requested = null;
    const loadFields = async () => {
        if (layerInput.value === requested) {
            return;
        }
        fields = [];
        fill(fieldList, []);
        fill(valueList, []);
        status.textContent = '';
        const layer = layerInput.value;
        requested = layer;
        if (!layer || !layers.some(item => item.name === layer)) {
            return;
        }
        status.textContent = '…';
        try {
            const response = await fetch(withParams(form.dataset.valuesUrl, { map: select.value, layer }));
            if (requested !== layer) {
                return;
            }
            status.textContent = '';
            if (!response.ok) {
                return;
            }
            fields = (await response.json()).fields || [];
            fill(fieldList, fields.map(field => [field.name, field.values.length + (field.truncated ? '+ ' : ' ') + form.dataset.valuesLabel]));
            showValues();
        } catch (error) {
            console.error(error);
            status.textContent = '';
        }
    };
    layerInput.addEventListener('change', loadFields);
    layerInput.addEventListener('input', () => {
        if (layers.some(item => item.name === layerInput.value)) {
            loadFields();
        }
    });
    fieldInput.addEventListener('change', showValues);
    fieldInput.addEventListener('input', showValues);

    const filter = document.getElementById('link-parts-filter');
    const parts = document.getElementById('link-parts');
    if (filter && parts) {
        const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        filter.addEventListener('input', () => {
            const words = normalize(filter.value).split(/\s+/).filter(Boolean);
            for (const item of parts.children) {
                const text = normalize(item.dataset.text || '');
                // Checked parts stay visible
                item.hidden = !item.querySelector('input').checked && !words.every(word => text.includes(word));
            }
        });
        filter.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
            }
        });
    }
    const count = document.getElementById('link-parts-count');
    const updateCount = () => {
        if (count && parts) {
            count.textContent = parts.querySelectorAll('input:checked').length;
        }
    };
    if (parts) {
        parts.addEventListener('change', updateCount);
    }

    // Correct a link: its values in the form
    const linkId = document.getElementById('link-id');
    const title = document.getElementById('link-form-title');
    const submit = document.getElementById('link-submit');
    const cancel = document.getElementById('link-cancel');
    const setMode = editing => {
        title.textContent = editing ? title.dataset.edit : title.dataset.new;
        submit.textContent = editing ? submit.dataset.edit : submit.dataset.new;
        cancel.hidden = !editing;
    };
    const clear = () => {
        form.reset();
        linkId.value = '';
        layers = [];
        fields = [];
        requested = null;
        fill(layerList, []);
        fill(fieldList, []);
        fill(valueList, []);
        if (filter) {
            filter.dispatchEvent(new Event('input'));
        }
        updateCount();
        setMode(false);
    };
    cancel.addEventListener('click', clear);
    for (const button of document.querySelectorAll('.documents-link-edit')) {
        button.addEventListener('click', async () => {
            const link = JSON.parse(button.dataset.link);
            clear();
            linkId.value = link.id;
            setMode(true);
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            select.value = link.map;
            document.getElementById('link-note').value = link.note || '';
            const others = [];
            for (const number of link.parts || []) {
                const box = parts ? [...parts.querySelectorAll('input')].find(input => input.value === number) : null;
                if (box) {
                    box.checked = true;
                } else {
                    others.push(number);
                }
            }
            document.getElementById('link-other-parts').value = others.join(', ');
            updateCount();
            layerInput.value = link.layer || '';
            fieldInput.value = link.field || '';
            document.getElementById('link-value').value = link.value || '';
            await loadLayers();
            // The lists of the layer, keeping the values of the link
            await loadFields();
            fieldInput.value = link.field || '';
            document.getElementById('link-value').value = link.value || '';
            showValues();
        });
    }
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
