{jmessage_bootstrap}

<h1>{@admin~documents.h1@}</h1>
<p class="lead">{@admin~documents.lead@}</p>

{if !$pdftotext}
<div class="alert alert-warning">{@admin~documents.nopdftotext@}</div>
{/if}

{if $canUpdate && count($collections)}
<form method="post" action="{jurl 'admin~documents:deleteCollection'}" id="documents-bulk-collections" onsubmit="return confirm('{@admin~documents.confirm.selected@}');">
  <input type="hidden" name="token" value="{$token}">
</form>
{/if}
<table class="table">
  <thead>
    <tr>
      {if $canUpdate && count($collections)}<th><input type="checkbox" class="form-check-input documents-select-all" data-form="documents-bulk-collections" title="{@admin~documents.selectall@}" aria-label="{@admin~documents.selectall@}"></th>{/if}
      <th>{@admin~documents.collection.title@}</th>
      <th>{@admin~documents.collection.type@}</th>
      <th>{@admin~documents.documents@}</th>
      <th>{@admin~documents.links@}</th>
      {if $canUpdate && count($collections)}<th></th>{/if}
    </tr>
  </thead>
  <tbody>
  {if count($collections)}{foreach $collections as $collection}
    <tr>
      {if $canUpdate}<td><input type="checkbox" class="form-check-input" name="ids[]" value="{$collection['id']|eschtml}" form="documents-bulk-collections" aria-label="{$collection['title']|eschtml}"></td>{/if}
      <td><a href="{jurl 'admin~documents:collection', array('id' => $collection['id'])}">{$collection['title']|eschtml}</a>
        {if $collection['description']}<br><small>{$collection['description']|eschtml}</small>{/if}</td>
      <td>{if $collection['type'] == 'regulation'}{@admin~documents.type.regulation@}{else}{@admin~documents.type.documents@}{/if}</td>
      <td>{$collection['documentCount']}</td>
      <td>{$collection['linkCount']}</td>
      {if $canUpdate}<td class="text-nowrap">
        <button type="button" class="btn btn-sm btn-outline-secondary documents-edit-toggle" data-target="collection-edit-{$collection['id']|eschtml}">{@admin~documents.edit@}</button>
        <form method="post" action="{jurl 'admin~documents:deleteCollection'}" class="d-inline" onsubmit="return confirm('{@admin~documents.confirm@}');">
          <input type="hidden" name="token" value="{$token}">
          <input type="hidden" name="id" value="{$collection['id']|eschtml}">
          <button type="submit" class="btn btn-sm btn-outline-danger">{@admin~documents.delete@}</button>
        </form>
      </td>{/if}
    </tr>
    {if $canUpdate}
    <tr id="collection-edit-{$collection['id']|eschtml}" hidden>
      <td></td>
      <td colspan="5">
        <form method="post" action="{jurl 'admin~documents:saveCollection'}" class="row g-2">
          <input type="hidden" name="token" value="{$token}">
          <input type="hidden" name="id" value="{$collection['id']|eschtml}">
          <input type="hidden" name="back" value="index">
          <div class="col-md-4"><input name="title" class="form-control" required maxlength="200" value="{$collection['title']|eschtml}" aria-label="{@admin~documents.collection.title@}"></div>
          <div class="col-md-3"><select name="type" class="form-select" aria-label="{@admin~documents.collection.type@}">
            <option value="regulation"{if $collection['type'] == 'regulation'} selected{/if}>{@admin~documents.type.regulation@}</option>
            <option value="documents"{if $collection['type'] != 'regulation'} selected{/if}>{@admin~documents.type.documents@}</option>
          </select></div>
          <div class="col-md-5"><textarea name="description" class="form-control" rows="1" maxlength="2000" aria-label="{@admin~documents.collection.description@}">{$collection['description']|eschtml}</textarea></div>
          <div class="col-12">
            <button type="submit" class="btn btn-sm btn-primary">{@admin~documents.save@}</button>
            <button type="button" class="btn btn-sm btn-outline-secondary documents-edit-toggle" data-target="collection-edit-{$collection['id']|eschtml}">{@admin~documents.cancel@}</button>
          </div>
        </form>
      </td>
    </tr>
    {/if}
  {/foreach}{else}
    <tr><td colspan="4">{@admin~documents.collection.none@}</td></tr>
  {/if}
  </tbody>
</table>
{if $canUpdate && count($collections)}
<p><button type="submit" class="btn btn-sm btn-outline-danger documents-bulk-submit" form="documents-bulk-collections" disabled>{@admin~documents.delete.selected@}</button></p>
{/if}

{if $canUpdate}
<h2>{@admin~documents.collection.new@}</h2>
<form method="post" action="{jurl 'admin~documents:saveCollection'}" class="mb-4">
  <input type="hidden" name="token" value="{$token}">
  <table class="table services-table">
    <tr><th><label for="doc-title">{@admin~documents.collection.title@}</label></th>
      <td><input id="doc-title" name="title" class="form-control" required maxlength="200" placeholder="{@admin~documents.collection.title.placeholder@}"></td></tr>
    <tr><th><label for="doc-type">{@admin~documents.collection.type@}</label></th>
      <td><select id="doc-type" name="type" class="form-select">
        <option value="regulation">{@admin~documents.type.regulation@}</option>
        <option value="documents">{@admin~documents.type.documents@}</option>
      </select>
      <div class="form-text">{@admin~documents.type.help@}</div></td></tr>
    <tr><th><label for="doc-description">{@admin~documents.collection.description@}</label></th>
      <td><textarea id="doc-description" name="description" class="form-control" rows="2" maxlength="2000"></textarea></td></tr>
  </table>
  <button type="submit" class="btn btn-primary">{@admin~documents.create@}</button>
</form>
{/if}

{include 'admin~documents_selection'}
