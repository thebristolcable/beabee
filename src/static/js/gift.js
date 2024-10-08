/* global $, document, stripe */

// https://stackoverflow.com/questions/10193294/how-can-i-tell-if-a-browser-supports-input-type-date
function checkDateInput() {
	var input = document.createElement('input');
	input.setAttribute('type','date');

	var notADateValue = 'not-a-date';
	input.setAttribute('value', notADateValue); 

	return input.value !== notADateValue;
}

(function () {
	var $form = $('.js-gift-form');
	var $errors = $('.js-gift-errors');
	var $startDate = $form.find('[name=startDate]');

	var form = $form.get(0);
	var validateForm =
		(form.reportValidity || form.checkValidity || function () { return true; }).bind(form);

	function setErrors(errors) {
		var errorHTML = errors
			.map(function (error) {
				return '<div class="alert alert-danger">' + error + '</div>';
			})
			.join('');

		$errors.html(errorHTML);
		$errors.get(0).scrollIntoView();
	}

	if (!checkDateInput()) {
		$startDate.attr({
			type: 'text',
			placeholder: 'dd/mm/yyyy',
			pattern: '[0-3]?\\d/[01]?\\d/\\d{4}'
		});

		$startDate.on('input', function () {
			this.setCustomValidity('');
			this.checkValidity();
		});

		$startDate.on('invalid', function () {
			this.setCustomValidity('Date must have the format dd/mm/yyyy');
		});
	}

	// Allow feedback on invalid inputs, but
	// must use gift type buttons to submit
	$form.on('submit', function (evt) {
		if (validateForm()) {
			evt.preventDefault();
		}
	});
	// Select gift type then submit
	$('.js-gift-type').on('click', function () {
		console.log(this.value);
		form.elements.monthlyAmount.value = this.value;
		if (validateForm()) {
			purchaseGift();
		}
	});

	function reset() {
		$form.find('button').prop('disabled', false);
		$form.find('[name=type]').prop('checked', false);
	}

	$form.on('submit', function (evt) {
		evt.preventDefault();
		purchaseGift();
	});

	function purchaseGift() {
		var data;
		if (checkDateInput()) {
			data = $form.serialize();
		} else {
			$startDate.prop('disabled', true);
			var startDate = $startDate.val() // d?d/m?m/yyyy to yyyy-mm-dd
				.split('/')
				.reverse()
				.map(function (p) { return p.length < 2 ? '0' + p : p; })
				.join('-');
			data = $form.serialize() + '&startDate=' + startDate;
			$startDate.prop('disabled', false);
		}

		$form.find('button').prop('disabled', true);

		$.ajax({
			url: '/gift',
			type: 'POST',
			data: data,
			success: function (data) {
				stripe.redirectToCheckout({
					sessionId: data.sessionId
				});
			},
			error: function (xhr) {
				reset();

				try {
					setErrors(JSON.parse(xhr.responseText));
				} catch (err) {
					setErrors(['An unknown error occured, please contact membership@thebristolcable.org']);
				}
			}
		});
	}

	reset();
})();
