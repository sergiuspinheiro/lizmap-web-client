{jmessage_bootstrap}

  <div>
    <h2>{@admin~admin.logs.counter.title@}</h2>
    
    <div class="form-actions">
      <a class="btn" href="/graph/estatis.php" target="_blank">{@admin~admin.logs.view.graphic@}</a>
      <iframe style="width: 100%; height: 50vh; border: 0;" src="/graph/estatis.php">
      </iframe>
    </div>

    <table class="table table-bordered table-striped">
      <thead>
        <tr>
          <th>{@admin~admin.logs.key@}</th>
          <th>{@admin~admin.logs.repository@}</th>
          <th>{@admin~admin.logs.project@}</th>
          <th>{@admin~admin.logs.counter@}</th>
        </tr>
      </thead>
      <tbody>
        {foreach $counter as $item}
        <tr>
          <td>{$item->key}</td>
          <td>{$item->repository}</td>
          <td>{$item->project}</td>
          <td>{$item->counter}</td>
        </tr>
        {/foreach}
      </tbody>
    </table>
  </div>

  <div class="form-actions">
    <a class="btn" href="{jurl 'admin~logs:index'}">{@admin~admin.configuration.button.back.label@}</a>
  </div>
