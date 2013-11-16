$(function() {

	if('ontouchstart' in document) {
		$('body').removeClass('no-touch').addClass('touch');
	}

	///// Socket Communications /////
	var socket = io.connect(window.location.protocol+'//'+window.location.host, {
		'reconnection limit': 5000,
		'sync disconnect on unload': true
	});




	///// Navigation /////
	var
		$nav = $('.main-nav'),
		$tabs = $('.tab');
	$nav.on('click', 'a', function() {
		var
			$a = $(this),
			target = $(this).attr('href').substr(1);

		navigateTo(target);
	});

	function navigateTo(target)
	{
		// store last page in cookie
		$.cookie('osc-nav', target);

		// shift focus on nav buttons
		$nav
			.find('li')
			.removeClass('active')
			.filter('.nav-'+target)
			.addClass('active');

		// shift focus on active tab
		$tabs
			.removeClass('active')
			.filter('.'+target+'-tab')
			.addClass('active');
	}

	// By Permalink
	if(window.location.hash)
	{
		var target = window.location.hash.substr(1);
		navigateTo(target);
	}

	// By Cookie
	if($.cookie('osc-nav'))
	{
		navigateTo($.cookie('osc-nav'));
	}





	///// Presets /////
	var longtouch;
	$('.presets-tab').on('click', '.tile', function(e) {
		var
			$tile = $(this),
			title = $.trim($tile.text());

		e.preventDefault();
		if($(e.target).hasClass('delete'))
		{
			var really = confirm('Do you really want to delete this Preset: '+title);
			if(really)
				socket.emit('deletePreset', title);
		}
		else if($tile.hasClass('create'))
		{
			// using a simple prompt is good for mobile devices and okay for desktop systems
			var promptedName = prompt('Choose a new Preset-Name');
			if(promptedName)
				socket.emit('newPreset', promptedName);
		}
		else
		{
			socket.emit('loadPreset', title);
		}
	}).on('touchstart', function(e) {
		var $tile = $(e.target).closest('.tile');

		if($tile.hasClass('create'))
			return;

		longtouch = setTimeout(function() {

			$tile.find('.delete').trigger('click');

		}, 1000 /*longtouch timeout*/);
	}).on('touchend', function() {
		clearTimeout(longtouch);
	});




	///// State /////
	var
		$stable = $('.state-table'),
		$all = $stable.find('input.all'),
		$btn = $stable.find('button');

	$stable.on('click', 'input', function() {
		var
			$other = $stable.find('tbody input'),
			anyChecked = (0 == $other.filter(':checked').length);

		if($(this).hasClass('all'))
		{
			$other
				.prop('checked', false);

			$all
				.prop('checked', true)
				.prop('disabled', true);

			$btn
				.text($btn.data('cltext'))
		}
		else
		{
			$all
				.prop('checked', anyChecked)
				.prop('disabled', anyChecked);

			$btn
				.text(anyChecked ? $btn.data('cltext') : $btn.data('rmtext'))
		}
	});

	$btn.on('click', function() {
		socket.emit('removeState', 
			$stable
				.find('tbody input:checked')
				.map(function() {
					return $(this).val();
				})
				.get()
		);
	});


	///// State-Update /////
	var
		$gtbody = $('.guests-tab tbody'),
		sourceNames = {z: 'Zeroconf', s: 'Static'};

	socket.on('update', function(reason, bundle) {
		console.log('update because of', reason, bundle);




		///// Guests /////
		$gtbody.find('> tr').remove();
		if(bundle.g.length > 0)
		{
			for(var i = 0; i < bundle.g.length; i++) {
				var guest = bundle.g[i];

				$('<tr>')
					.appendTo($gtbody)
					.append($('<td>').text(guest.n))
					.append($('<td>').html(guest.a + '<wbr>:' + guest.p))
					.append($('<td class="hidden-xs">').text(
						sourceNames[guest.s]
					))
					.append($('<td class="hidden-xs">').text(
						moment(guest.t).fromNow()
					)).attr('title', moment(guest.t).calendar());
			};
		}
		else {
			var t = 'Currently no guests are visible via Zeroconf. Maybe they need to be configured as static guests?';

			$('<tr>')
				.appendTo($gtbody)
				.append(
					$('<td colspan="4" class="no-guests hidden-xs">').text(t)
				);

			$('<tr>')
				.appendTo($gtbody)
				.append(
					$('<td colspan="2" class="no-guests visible-xs">').text(t)
				);
		}




		///// Presets /////
		var
			$presetsContainer = $('.presets-tab .row'),
			$tileTemplate = $presetsContainer.find('.tile.create');

		$presetsContainer.find('.tile:not(.create)').remove();

		var stateClasses = {
			'new': 'animated flipInY',
			'used': 'animated bounce'
		};

		for(var preset in bundle.p) {
			var state = bundle.p[preset];

			// Somehow pulse/highlight new tiles
			$tileTemplate
				.clone()
				.removeClass('create')
				.addClass(
					stateClasses[state]
				)
				.appendTo($presetsContainer)
				.find('p')
					.text(preset);
		}




		///// State /////
		var
			$stbody = $stable.find('tbody'),
			messages = bundle.m;

		if(messages.length == 0)
		{
			if($stbody.find('.no-messages').length == 0)
			{
				$('<tr class="no-messages">')
					.append(
						$('<td colspan="2">').text('Currently no messages are in the internal storage. Move some sliders or load a preset.')
					)
					.appendTo($stbody);
			}
		}
		else
		{
			$stbody.find('.no-messages').remove();
		}

		$stbody.find('tr:not(.no-messages)').each(function() {
			var
				$tr = $(this),
				message = $tr.find('input').prop('value'),
				idx = $.inArray(message, messages);

			if(idx == -1)
			{
				// visible message is not in messages array anymore
				$tr.find('input').prop('checked', true).trigger('click');
				$tr.remove();
			}
			else
			{
				// visible message is in messages array
				messages.splice(idx, 1);
			}
		});

		$.each(messages, function(i, message) {
			$('<tr>')
				.append(
					$('<td>').append(
						$('<input type="checkbox">')
							.attr('value', message)
					),
					$('<td>').text(message)
				)
				.appendTo($stbody);
		});
	});
});