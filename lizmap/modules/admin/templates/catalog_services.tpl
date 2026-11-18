{jmessage_bootstrap}

<h1>{@admin~catalog_services.h1@}</h1>
<p class="lead">{@admin~catalog_services.lead@}</p>

{if !$catalogEnabled}
<div class="alert alert-warning">{@admin~catalog_services.catalog.disabled@}</div>
{/if}

<table class="table">
  <thead>
    <tr>
      <th>{@admin~catalog_services.title@}</th>
      <th>{@admin~catalog_services.type@}</th>
      <th>{@admin~catalog_services.access@}</th>
      <th>{@admin~catalog_services.test@}</th>
      {if $canUpdate}<th></th>{/if}
    </tr>
  </thead>
  <tbody>
  {if count($services)}{foreach $services as $service}
    <tr>
      <td><strong>{$service['title']|eschtml}</strong><br><small class="text-break">{$service['url']|eschtml}</small>
        {if $service['description']}<br><small>{$service['description']|eschtml}</small>{/if}</td>
      <td>{$service['typeLabel']|eschtml}</td>
      <td>{if $service['access'] == 'all'}{@admin~catalog_services.access.all@}{elseif $service['access'] == 'connected'}{@admin~catalog_services.access.connected@}{else}
        {if $service['groupsText']}{@admin~catalog_services.groups@}: {$service['groupsText']|eschtml}<br>{/if}
        {if $service['usersText']}{@admin~catalog_services.users@}: {$service['usersText']|eschtml}{/if}
      {/if}</td>
      <td>{if $service['test']}
        <span class="badge text-bg-{if $service['test']['ok']}success{else}danger{/if}">{if $service['test']['ok']}OK{else}{@admin~catalog_services.test.failed@}{/if}</span>
        <br><small>{$service['test']['message']|eschtml} {$service['test']['date']} UTC</small>
      {else}<span class="badge text-bg-secondary">{@admin~catalog_services.test.none@}</span>{/if}</td>
      {if $canUpdate}
      <td class="text-nowrap">
        <a class="btn btn-sm" href="{jurl 'admin~catalog_services:index', array('id' => $service['id'])}#service-form">{@admin~catalog_services.edit@}</a>
        <form method="post" action="{jurl 'admin~catalog_services:test'}" class="d-inline">
          <input type="hidden" name="token" value="{$token}"><input type="hidden" name="id" value="{$service['id']}">
          <button type="submit" class="btn btn-sm">{@admin~catalog_services.test.run@}</button>
        </form>
        <form method="post" action="{jurl 'admin~catalog_services:delete'}" class="d-inline"
          onsubmit="return confirm('{@admin~catalog_services.delete.confirm@}');">
          <input type="hidden" name="token" value="{$token}"><input type="hidden" name="id" value="{$service['id']}">
          <button type="submit" class="btn btn-sm btn-danger">{@admin~catalog_services.delete@}</button>
        </form>
      </td>
      {/if}
    </tr>
  {/foreach}{else}
    <tr><td colspan="5">{@admin~catalog_services.none@}</td></tr>
  {/if}
  </tbody>
</table>

{if $canUpdate}
<h2 id="service-form">{if $edit['id']}{@admin~catalog_services.form.edit@}{else}{@admin~catalog_services.form.new@}{/if}</h2>
<form method="post" action="{jurl 'admin~catalog_services:save'}" class="mb-4">
  <input type="hidden" name="token" value="{$token}">
  <input type="hidden" name="id" value="{$edit['id']|eschtml}">
  <table class="table services-table">
    <tr><th><label for="service-type">{@admin~catalog_services.type@}</label></th>
      <td><select id="service-type" name="type" class="form-select">
        {foreach $typeOptions as $option}<option value="{$option['id']}"{if $option['selected']} selected{/if}>{$option['label']|eschtml}</option>{/foreach}
      </select></td></tr>
    <tr><th><label for="service-url">{@admin~catalog_services.url@}</label></th>
      <td><input id="service-url" name="url" type="url" class="form-control" required maxlength="2000" value="{$edit['url']|eschtml}">
      <div class="form-text">{@admin~catalog_services.url.help@}</div></td></tr>
    <tr><th><label for="service-title">{@admin~catalog_services.title@}</label></th>
      <td><input id="service-title" name="title" class="form-control" maxlength="200" value="{$edit['title']|eschtml}"></td></tr>
    <tr><th><label for="service-description">{@admin~catalog_services.description@}</label></th>
      <td><textarea id="service-description" name="description" class="form-control" rows="2" maxlength="1000">{$edit['description']|eschtml}</textarea></td></tr>
    <tr><th>{@admin~catalog_services.access@}</th>
      <td>
        <div class="form-check"><input class="form-check-input" type="radio" name="access" id="access-all" value="all"{if $edit['access'] == 'all'} checked{/if}>
          <label class="form-check-label" for="access-all">{@admin~catalog_services.access.all@}</label></div>
        <div class="form-check"><input class="form-check-input" type="radio" name="access" id="access-connected" value="connected"{if $edit['access'] == 'connected'} checked{/if}>
          <label class="form-check-label" for="access-connected">{@admin~catalog_services.access.connected@}</label></div>
        <div class="form-check"><input class="form-check-input" type="radio" name="access" id="access-restricted" value="restricted"{if $edit['access'] == 'restricted'} checked{/if}>
          <label class="form-check-label" for="access-restricted">{@admin~catalog_services.access.restricted@}</label></div>
      </td></tr>
    <tr><th><label for="service-groups">{@admin~catalog_services.groups@}</label></th>
      <td><select id="service-groups" name="groups[]" class="form-select" multiple size="{$groupSize}">
        {foreach $groupOptions as $option}<option value="{$option['id']|eschtml}"{if $option['selected']} selected{/if}>{$option['label']|eschtml}</option>{/foreach}
      </select>
      <div class="form-text">{@admin~catalog_services.groups.help@}</div></td></tr>
    <tr><th><label for="service-users">{@admin~catalog_services.users@}</label></th>
      <td><input id="service-users" name="users" class="form-control" value="{$edit['usersText']|eschtml}">
      <div class="form-text">{@admin~catalog_services.users.help@}</div></td></tr>
  </table>
  <button type="submit" class="btn btn-primary">{@admin~catalog_services.save@}</button>
  {if $edit['id']}<a class="btn" href="{jurl 'admin~catalog_services:index'}">{@admin~catalog_services.cancel@}</a>{/if}
</form>
{/if}
