{jmessage_bootstrap}

<h1>{@admin~documents.h1@}</h1>
<p class="lead">{@admin~documents.lead@}</p>

{if !$pdftotext}
<div class="alert alert-warning">{@admin~documents.nopdftotext@}</div>
{/if}

<table class="table">
  <thead>
    <tr>
      <th>{@admin~documents.collection.title@}</th>
      <th>{@admin~documents.collection.type@}</th>
      <th>{@admin~documents.documents@}</th>
      <th>{@admin~documents.links@}</th>
    </tr>
  </thead>
  <tbody>
  {foreach $collections as $collection}
    <tr>
      <td><a href="{jurl 'admin~documents:collection', array('id' => $collection['id'])}">{$collection['title']|eschtml}</a>
        {if $collection['description']}<br><small>{$collection['description']|eschtml}</small>{/if}</td>
      <td>{if $collection['type'] == 'regulation'}{@admin~documents.type.regulation@}{else}{@admin~documents.type.documents@}{/if}</td>
      <td>{$collection['documentCount']}</td>
      <td>{$collection['linkCount']}</td>
    </tr>
  {foreachelse}
    <tr><td colspan="4">{@admin~documents.collection.none@}</td></tr>
  {/foreach}
  </tbody>
</table>

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
