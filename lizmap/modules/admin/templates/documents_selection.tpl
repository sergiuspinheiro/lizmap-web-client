<script>
{literal}
(function () {
    // Check the items of a list to delete them together
    const update = form => {
        const boxes = document.querySelectorAll('input[type="checkbox"][form="' + form + '"]');
        const checked = [...boxes].filter(box => box.checked).length;
        for (const button of document.querySelectorAll('.documents-bulk-submit[form="' + form + '"]')) {
            button.disabled = checked === 0;
        }
        for (const all of document.querySelectorAll('.documents-select-all[data-form="' + form + '"]')) {
            all.checked = boxes.length > 0 && checked === boxes.length;
            all.indeterminate = checked > 0 && checked < boxes.length;
        }
    };
    for (const all of document.querySelectorAll('.documents-select-all')) {
        all.addEventListener('change', () => {
            for (const box of document.querySelectorAll('input[type="checkbox"][form="' + all.dataset.form + '"]')) {
                box.checked = all.checked;
            }
            update(all.dataset.form);
        });
        for (const box of document.querySelectorAll('input[type="checkbox"][form="' + all.dataset.form + '"]')) {
            box.addEventListener('change', () => update(all.dataset.form));
        }
        update(all.dataset.form);
    }
    // Show or hide the form editing an item
    for (const button of document.querySelectorAll('.documents-edit-toggle')) {
        button.addEventListener('click', () => {
            const row = document.getElementById(button.dataset.target);
            if (row) {
                row.hidden = !row.hidden;
                if (!row.hidden) {
                    const input = row.querySelector('input:not([type="hidden"]), textarea');
                    if (input) {
                        input.focus();
                    }
                }
            }
        });
    }
})();
{/literal}
</script>
