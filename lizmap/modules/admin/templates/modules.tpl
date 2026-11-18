{jmessage_bootstrap}

<h1>{@admin~modules.h1@}</h1>
<p class="lead">{@admin~modules.lead@}</p>

{if $canUpdate}
{form $form, 'admin~modules:save', array(), 'htmlbootstrap'}

<div>
  <h2>{@admin~modules.section.modules@}</h2>
  <table class="table services-table">
    {formcontrols array('catalog', 'layerCompare', 'aiAssistant')}
      <tr><th>{ctrl_label}</th><td>{ctrl_control}</td></tr>
    {/formcontrols}
  </table>
</div>

<div>
  <h2>{@admin~modules.section.ai@}</h2>
  <p>{@admin~modules.section.ai.help@}</p>
  <table class="table services-table">
    {formcontrols array('provider', 'model', 'url')}
      <tr><th>{ctrl_label}</th><td>{ctrl_control}</td></tr>
    {/formcontrols}
    <tr>
      <th>{@admin~modules.apiKey.label@}</th>
      <td>
        <p>{if $hasApiKey}<span class="badge text-bg-success">{@admin~modules.apiKey.saved@}</span>{else}<span class="badge text-bg-secondary">{@admin~modules.apiKey.none@}</span>{/if}</p>
        <div class="mb-2">{ctrl_control 'apiKey'}</div>
        <div class="mb-2">{ctrl_control 'removeApiKey'} {ctrl_label 'removeApiKey'}</div>
      </td>
    </tr>
    {formcontrols array('allowAnonymous', 'sendStatistics', 'maxFeatures', 'sendFeatures', 'maxRows', 'contextLength', 'requestsPerHour')}
      <tr><th>{ctrl_label}</th><td>{ctrl_control}</td></tr>
    {/formcontrols}
  </table>
</div>

<div>
  <h2>{@admin~modules.section.import@}</h2>
  <p>{@admin~modules.section.import.help@}</p>
  <table class="table services-table">
    {formcontrols array('quotaSize', 'quotaLayers')}
      <tr><th>{ctrl_label}</th><td>{ctrl_control}</td></tr>
    {/formcontrols}
  </table>
</div>

<div class="form-actions">{formsubmit '_submit'}</div>
{/form}
{else}
<p><span class="badge text-bg-{if $hasApiKey}success{else}secondary{/if}">{@admin~modules.apiKey.label@}: {if $hasApiKey}{@admin~modules.apiKey.saved@}{else}{@admin~modules.apiKey.none@}{/if}</span></p>
{formdatafull $form, 'htmlbootstrap'}
{/if}
