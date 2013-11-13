$(function() {
	var
		$tbody = $('.guests-tab tbody'),
		$presetsContainer = $('.presets-tab .row'),
		$nav = $('.main-nav'),
		$tabs = $('.tab'),
		sourceNames = {z: 'Zeroconf', s: 'Static'};

	// Navigation
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



	// preset buttons
	$('.presets-tab').on('touchstart click', '.tile', function(e) {
		var $tile = $(this);

		e.preventDefault();
		if($tile.hasClass('create'))
		{
			// using a simple prompt is good for mobile devices and okay for desktop systems
			var promptedName = prompt('Choose a new Preset-Name');
			if(promptedName)
				socket.emit('newPreset', promptedName);
		}
		else
		{
			socket.emit('loadPreset', $.trim($tile.text()));
		}
	});



	// Socket communication
	var socket = io.connect(window.location.protocol+'//'+window.location.host, {
		'reconnection limit': 5000,
		'sync disconnect on unload': true
	});

	socket.on('update', function(reason, bundle) {
		console.log('update because of', reason, bundle);

		// clean and re-fill guest table
		$tbody.find('> tr').remove();
		if(bundle.g.length > 0)
		{
			for(var i = 0; i < bundle.g.length; i++) {
				var guest = bundle.g[i];

				$('<tr>')
					.appendTo($tbody)
					.append($('<td>').text(guest.n))
					.append($('<td>').text(guest.a + ':' + guest.p))
					.append($('<td>').text(
						sourceNames[guest.s]
					))
					.append($('<td>').text(
						moment(guest.t).fromNow()
					));
			};
		}
		else {
			$('<tr>')
				.appendTo($tbody)
				.append(
					$('<td colspan="4" class="no-guests">')
						.text('Currently no guests are visible via Zeroconf. Maybe they need to be configured as static guests?')
				)
		}

		// clear and re-fill preset list
		var $tileTemplate = $presetsContainer.find('.tile.create');
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
				.children('p')
					.text(preset);
		}

	});
});