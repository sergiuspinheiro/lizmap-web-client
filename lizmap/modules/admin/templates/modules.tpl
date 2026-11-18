{jmessage_bootstrap}

<h1>{@admin~modules.h1@}</h1>
<p class="lead">{@admin~modules.lead@}</p>

{if $canUpdate}
{form $form, 'admin~modules:save', array(), 'htmlbootstrap'}

<div>
  <h2>{@admin~modules.section.modules@}</h2>
  <table class="table services-table">
    {formcontrols array('catalog', 'layerCompare', 'overlay', 'aiAssistant')}
      <tr><th>{ctrl_label}</th><td>{ctrl_control}</td></tr>
    {/formcontrols}
  </table>
</div>

<div>
  <h2>{@admin~modules.section.ai@}</h2>
  <p>{@admin~modules.section.ai.help@}</p>
  <table class="table services-table">
    {formcontrols array('provider', 'model', 'searchModel', 'url')}
      <tr><th>{ctrl_label}</th><td>{ctrl_control}</td></tr>
    {/formcontrols}
    {if $isOllama}
    <tr><th>{@admin~modules.installedModels.label@}</th>
      <td id="ollama-models" data-models="{$modelsJson|eschtml}" data-choose="{@admin~modules.installedModels.choose@}">
      {if count($models)}{foreach $models as $model}<code>{$model['label']|eschtml}</code><br>{/foreach}
      <div class="form-text">{@admin~modules.installedModels.help@}</div>
      {else}<span class="text-warning">{@admin~modules.installedModels.none@}</span>{/if}
      </td></tr>
    {/if}
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
<script>
{literal}
(function () {
    // A list of the installed models next to the fields of the models
    const cell = document.getElementById('ollama-models');
    const models = cell ? JSON.parse(cell.dataset.models || '[]') : [];
    if (models.length === 0) {
        return;
    }
    for (const name of ['model', 'searchModel']) {
        const input = document.querySelector('input[name="' + name + '"]');
        if (!input) {
            continue;
        }
        const select = document.createElement('select');
        select.className = 'form-select mt-1';
        select.setAttribute('aria-label', cell.dataset.choose);
        const first = document.createElement('option');
        first.value = '';
        first.textContent = cell.dataset.choose;
        select.append(first);
        for (const model of models) {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.label;
            select.append(option);
        }
        select.value = models.some(model => model.name === input.value) ? input.value : '';
        select.addEventListener('change', () => {
            if (select.value !== '') {
                input.value = select.value;
            }
        });
        input.addEventListener('input', () => {
            select.value = models.some(model => model.name === input.value) ? input.value : '';
        });
        input.after(select);
    }
})();
{/literal}
</script>
{else}
<p><span class="badge text-bg-{if $hasApiKey}success{else}secondary{/if}">{@admin~modules.apiKey.label@}: {if $hasApiKey}{@admin~modules.apiKey.saved@}{else}{@admin~modules.apiKey.none@}{/if}</span></p>
{formdatafull $form, 'htmlbootstrap'}
{/if}
